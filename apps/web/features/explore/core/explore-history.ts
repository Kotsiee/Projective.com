/// <reference lib="dom" />

import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import { profileHandleOf } from "./routing.ts";

/**
 * explore-history — the session-scoped visit stack behind the contextual **Back** control on
 * `/[handle]` and `/view/[id]`.
 *
 * The browser's own history cannot answer "where in Explore did I come from": it holds every page,
 * it cannot be read, and a listing reached from a profile reached from a filtered search is three
 * entries whose relationship the address bar has forgotten. So the Explore TREE — `/explore` with
 * its query, `/view/[id]`, and everything under a `/@handle` — keeps its own stack in
 * `sessionStorage`, and Back walks that: from a listing to the profile it was opened from, from the
 * profile to the exact `/explore?category=…&price=…` the visitor left, filters intact.
 *
 * # The pure half
 *
 * `visit` · `returnTo` · `ensureTop` · `retop` · `backTarget` take a stack and return a new one (or
 * a target) and touch nothing — the unit tests pin them. Two rules carry the design:
 *
 *  - **A visit outside the tree breaks the chain.** Arriving at a profile from `/projects` is not a
 *    step deeper into Explore, and Back from it must not resurrect a search the visitor left ten
 *    pages ago. The break is a MARKER entry ({@link HISTORY_BREAK}), not a cleared stack, because
 *    the browser's own Back may bring the visitor straight back to the page BEFORE the excursion —
 *    and that page's chain is still intact behind the marker.
 *  - **Arriving is not always advancing.** A page reached by the browser's history (`back_forward`)
 *    or by this control's own pop is a RETURN, and the stack is walked back to that entry rather
 *    than growing; a page reached by a link is a forward visit and pushes. The navigation TYPE tells
 *    them apart, so a forward link to a page visited earlier is still a new step (with a real
 *    history, going back from it lands on the page before it — not on the earlier visit).
 *
 * # The browser half
 *
 * {@link ensureTracked} records the current page once (every island that needs the stack calls it,
 * so the answer does not depend on which island hydrates first) and keeps the entry current — a
 * page that re-writes its own URL in place (`/explore` refining a filter, the Reviews stance switch)
 * is re-recorded at `pagehide`, so the stack carries the state the visitor actually LEFT.
 * {@link navigateBack} then prefers the browser's own history entry when it IS the target (an
 * instant, cached restore) and falls back to a real navigation otherwise.
 */

// #region Constants
/** Where Back lands when the stack has nothing eligible beneath the current page. */
export const EXPLORE_FALLBACK = "/explore";

/** The marker recorded for a visit OUTSIDE the tree — never a URL, so it cannot be navigated to. */
export const HISTORY_BREAK = "";

/** The stack's cap. A chain longer than this has long since stopped meaning "where I came from". */
export const HISTORY_MAX = 50;
// #endregion

// #region Eligibility
/**
 * Whether a `pathname + search` belongs to the Explore tree: `/explore` (any query), `/view/…`, or
 * the `/[handle]` namespace and every page under it (the profile's sections, its item viewer, its
 * availability calendar).
 */
export function isExploreUrl(url: string): boolean {
	const path = pathOf(url);
	if (path === "/explore" || path.startsWith("/explore/")) return true;
	if (path.startsWith("/view/")) return true;
	return profileHandleOf(path) !== null;
}

/** `pathname + search` — the ONE form every entry takes, so a filtered search survives the trip. */
export function urlOf(loc: { pathname: string; search: string }): string {
	return `${loc.pathname}${loc.search}`;
}

function pathOf(url: string): string {
	const q = url.indexOf("?");
	return q === -1 ? url : url.slice(0, q);
}
// #endregion

// #region The pure stack
/** A forward visit: push an eligible URL (never twice in a row), or a break for anything else. */
export function visit(stack: readonly string[], url: string): string[] {
	if (!isExploreUrl(url)) {
		// Nothing to break at the start of a chain, and one break says as much as two.
		if (stack.length === 0 || stack[stack.length - 1] === HISTORY_BREAK) return [...stack];
		return cap([...stack, HISTORY_BREAK]);
	}
	if (stack[stack.length - 1] === url) return [...stack];
	return cap([...stack, url]);
}

/**
 * A RETURN to `url` (the browser's Back/Forward, or this control's own pop): walk the stack back to
 * the entry, discarding everything above it. A URL the stack never held is treated as a forward
 * visit — a session that was cleared, or a return to a page tracked before the stack existed.
 */
export function returnTo(stack: readonly string[], url: string): string[] {
	const idx = stack.lastIndexOf(url);
	if (idx === -1 || url === HISTORY_BREAK) return visit(stack, url);
	return stack.slice(0, idx + 1);
}

/** A reload: the page is already on top, or should be. */
export function ensureTop(stack: readonly string[], url: string): string[] {
	return visit(stack, url);
}

/**
 * Re-record the entry at `index` with the URL the page now carries — for a page that re-wrote its
 * own address in place. Only an ELIGIBLE replacement is written, and only over an eligible entry:
 * a page cannot turn into a break, and a break cannot turn into a page.
 */
export function retop(stack: readonly string[], index: number, url: string): string[] {
	if (index < 0 || index >= stack.length) return [...stack];
	if (stack[index] === HISTORY_BREAK || !isExploreUrl(url)) return [...stack];
	const next = [...stack];
	next[index] = url;
	return next;
}

/**
 * Where Back goes from the entry at `index`: the entry beneath it, when that entry is a page in the
 * tree — else the fallback. A break beneath it means the visitor arrived from outside the tree, and
 * "back" from there is the tree's root, not the page before the excursion.
 */
export function backTarget(
	stack: readonly string[],
	index: number,
	fallback = EXPLORE_FALLBACK,
): string {
	const prev = index > 0 && index <= stack.length ? stack[index - 1] : undefined;
	if (!prev || prev === HISTORY_BREAK || !isExploreUrl(prev)) return fallback;
	return prev;
}

/**
 * The accessible name for a Back control landing on `target`: what the visible "Back" cannot say.
 * A profile names its handle so a listing's Back reads "Back to @juno", not "Back to profile".
 */
export function backLabel(target: string): string {
	const path = pathOf(target);
	if (path === "/explore" || path.startsWith("/explore/")) return "Back to Explore";
	const handle = profileHandleOf(path);
	if (handle) return `Back to @${handle}`;
	if (path.startsWith("/view/")) return "Back to the listing";
	return "Back";
}

function cap(stack: string[]): string[] {
	return stack.length > HISTORY_MAX ? stack.slice(stack.length - HISTORY_MAX) : stack;
}

/** Parse a stored stack; anything malformed reads as empty rather than throwing. */
export function parseStack(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((e) => typeof e === "string") : [];
	} catch {
		return [];
	}
}
// #endregion

// #region The browser half
/** The kind of arrival the browser reports for the current document. */
export type ArrivalKind = "navigate" | "reload" | "back_forward" | "unknown";

/** How this document was reached, from the Navigation Timing entry. */
function arrivalKind(): ArrivalKind {
	try {
		const entry = performance.getEntriesByType("navigation")[0] as
			| { type?: string }
			| undefined;
		const type = entry?.type;
		if (type === "reload" || type === "back_forward" || type === "navigate") return type;
	} catch {
		// No Performance API — treat as a plain navigation below.
	}
	return "unknown";
}

function readStack(): string[] {
	return parseStack(readStored("session", SessionKeys.EXPLORE_HISTORY));
}

function writeStack(stack: readonly string[]): void {
	writeStored("session", SessionKeys.EXPLORE_HISTORY, JSON.stringify(stack));
}

/** The index of this page's entry in the stack once tracked; `-1` until then. */
let trackedIndex = -1;
let tracked = false;

/**
 * Record the current page in the stack — ONCE per document, however many islands ask — and keep
 * the entry current until the page is left. Safe to call from any island's mount effect and a no-op
 * on the server (there is no `location` to record).
 */
export function ensureTracked(): void {
	if (tracked) return;
	if (typeof location === "undefined" || typeof document === "undefined") return;
	tracked = true;

	const record = (returning: boolean): void => {
		const url = urlOf(location);
		const stack = readStack();
		const next = returning ? returnTo(stack, url) : visit(stack, url);
		trackedIndex = isExploreUrl(url) ? next.lastIndexOf(url) : -1;
		writeStack(next);
	};

	const url = urlOf(location);
	const popped = readStored("session", SessionKeys.EXPLORE_HISTORY_POP);
	if (popped !== null) removeStored("session", SessionKeys.EXPLORE_HISTORY_POP);
	const kind = arrivalKind();
	record(popped === url || kind === "back_forward");

	// A page restored from the back-forward cache never re-runs this module's load path, so the
	// restore is re-recorded as the return it is — and the pop marker a `history.back()` wrote is
	// consumed here, since the load path that would have read it never ran. A first `pageshow`
	// (not persisted) is the load itself and has just been handled above.
	globalThis.addEventListener("pageshow", (e) => {
		if (!(e as PageTransitionEvent).persisted) return;
		removeStored("session", SessionKeys.EXPLORE_HISTORY_POP);
		record(true);
	});

	// The URL the visitor LEAVES with is the one worth keeping — `/explore` re-writes its query as
	// filters change, and the Reviews stance switch mirrors into `?as=`. `pagehide` fires for every
	// way out (a link, the browser's Back, a closed tab) and a synchronous storage write survives it.
	globalThis.addEventListener("pagehide", () => {
		if (trackedIndex < 0) return;
		writeStack(retop(readStack(), trackedIndex, urlOf(location)));
	});
}

/**
 * Where Back goes from THIS page: the previous entry of the tree, or `fallback`. Tracks the page
 * first if nothing has yet, so the answer does not depend on hydration order. Reads the stack fresh
 * on every call, because the answer at click time is the one that matters.
 */
export function resolveBackTarget(fallback = EXPLORE_FALLBACK): string {
	ensureTracked();
	if (trackedIndex < 0) return fallback;
	return backTarget(readStack(), trackedIndex, fallback);
}

/**
 * The `pathname + search` of the session-history entry just behind this one, when the browser will
 * say exactly — the Navigation API — and `null` otherwise.
 *
 * `document.referrer` is deliberately NOT used as a proxy. It names the document that linked here,
 * which is usually the entry behind this one and sometimes is not: the ticket deep link pushes an
 * entry on top of the page it opens on, so after a ticket has been opened and closed the entry
 * behind this page is this page, and a `history.back()` aimed at the referrer would land nowhere.
 * Without the exact answer the control takes a real navigation, which is merely slower.
 */
function previousHistoryUrl(): string | null {
	try {
		const nav = (globalThis as {
			navigation?: {
				currentEntry?: { index: number } | null;
				entries(): { url: string | null }[];
			};
		}).navigation;
		if (!nav?.currentEntry || typeof nav.entries !== "function") return null;
		const prev = nav.entries()[nav.currentEntry.index - 1];
		if (!prev?.url) return null;
		const u = new URL(prev.url);
		return u.origin === location.origin ? urlOf(u) : null;
	} catch {
		return null;
	}
}

/**
 * Go to `target`. When the browser's own previous history entry IS the target, `history.back()`
 * takes the visitor there through the back-forward cache — an instant restore of the page as they
 * left it, scroll position included, with no request. Otherwise a real navigation; the pop marker
 * tells the arriving page's tracker to walk the stack back rather than push.
 */
export function navigateBack(target: string): void {
	if (typeof location === "undefined") return;
	if (target === urlOf(location)) return;
	writeStored("session", SessionKeys.EXPLORE_HISTORY_POP, target);
	if (history.length > 1 && previousHistoryUrl() === target) {
		history.back();
		return;
	}
	location.assign(target);
}
// #endregion
