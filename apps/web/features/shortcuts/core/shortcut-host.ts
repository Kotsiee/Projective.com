/// <reference lib="dom" />
import { isAppleDevice, isFindInThreadShortcut } from "@features/shell/core/shortcuts.ts";
import { shortcutOn } from "./shortcut-registry.ts";
import { pickSearchTarget, searchIntentOf, type SearchTargetRole } from "./search-targets.ts";

/**
 * shortcut-host — the one `document` listener behind the search shortcuts (`/`, Ctrl/Cmd+/,
 * Ctrl/Cmd+Shift+/) and the in-thread finder (Ctrl/Cmd+F), Decision #418. Fields and finders
 * register here rather than each binding a key; the listener exists while anything is registered and
 * is removed with the last registration. Registration order is shared across islands because every
 * island imports this one module.
 */

// #region Shapes
/** A search field a search shortcut can focus. */
export interface SearchTarget {
	role: SearchTargetRole;
	/** The field, or an element holding it. */
	element: () => HTMLElement | null;
	/** Ranks rivals of one role; higher wins (default 0). */
	priority?: number;
	/** Whether the field may take focus now. Default: rendered, connected and not behind a modal. */
	available?: () => boolean;
	/** Bring the search up. Default: focus and select the field. */
	activate?: () => void;
}

/** A finder that answers Ctrl/Cmd+F in place of the browser's find. */
export interface FindTarget {
	/** The surface the finder searches; the key is the browser's again while it is hidden. */
	element: () => HTMLElement | null;
	open: () => void;
}
// #endregion

// #region Reachability
const MODAL = "[aria-modal='true'], dialog[open]";

/** The text field a target element is or holds. */
export function searchFieldOf(el: HTMLElement | null): HTMLInputElement | null {
	if (!el) return null;
	if (el instanceof HTMLInputElement) return el;
	return el.querySelector<HTMLInputElement>("input:not([type='hidden'])");
}

/**
 * Whether `el` can be reached by the keyboard now: connected, drawn, visible, not inside an `inert`
 * subtree, and inside the open modal when one is open (not every overlay marks the page inert).
 */
export function isReachable(el: HTMLElement | null): boolean {
	if (!el || !el.isConnected || el.closest("[inert]")) return false;
	if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === "hidden") {
		return false;
	}
	const modals = document.querySelectorAll(MODAL);
	return modals.length === 0 || [...modals].some((modal) => modal.contains(el));
}
// #endregion

// #region Registry
let seq = 0;
let bound = false;
const searchTargets = new Map<SearchTarget, number>();
const findTargets = new Map<FindTarget, number>();

function availableOf(target: SearchTarget): boolean {
	if (target.available) return target.available();
	return isReachable(searchFieldOf(target.element()));
}

function activateOf(target: SearchTarget): void {
	if (target.activate) {
		target.activate();
		return;
	}
	const field = searchFieldOf(target.element());
	field?.focus();
	field?.select();
}

function reachableFinder(): FindTarget | null {
	let best: FindTarget | null = null;
	let bestSeq = -1;
	for (const [target, order] of findTargets) {
		if (order > bestSeq && isReachable(target.element())) {
			best = target;
			bestSeq = order;
		}
	}
	return best;
}

function isApple(): boolean {
	const nav = globalThis.navigator;
	return !!nav && isAppleDevice(nav.platform || nav.userAgent);
}

function onKeyDown(event: KeyboardEvent): void {
	if (event.defaultPrevented || event.isComposing) return;
	if (findTargets.size > 0 && isFindInThreadShortcut(event, isApple())) {
		if (!shortcutOn("find-in-conversation")) return;
		const finder = reachableFinder();
		if (!finder) return;
		event.preventDefault();
		finder.open();
		return;
	}
	const target = event.target instanceof Element ? event.target : null;
	const intent = searchIntentOf(event, target);
	if (!intent || !shortcutOn(intent.shortcut)) return;
	const relevant = (role: SearchTargetRole) =>
		role === intent.role || (intent.role === "page" && role === "header");
	const candidates = [...searchTargets].map(([entry, order]) => ({
		entry,
		role: entry.role,
		priority: entry.priority ?? 0,
		seq: order,
		available: relevant(entry.role) && availableOf(entry),
	}));
	const picked = pickSearchTarget(intent.role, candidates);
	if (!picked) return;
	event.preventDefault();
	activateOf(picked.entry);
}

function sync(): void {
	if (typeof document === "undefined") return;
	const live = searchTargets.size + findTargets.size > 0;
	if (live && !bound) document.addEventListener("keydown", onKeyDown);
	else if (!live && bound) document.removeEventListener("keydown", onKeyDown);
	bound = live;
}

/** Offer a search field to the search shortcuts. Returns an idempotent release. Client-only. */
export function registerSearchTarget(target: SearchTarget): () => void {
	searchTargets.set(target, ++seq);
	sync();
	return () => {
		if (searchTargets.delete(target)) sync();
	};
}

/** Offer a finder to Ctrl/Cmd+F. Returns an idempotent release. Client-only. */
export function registerFindTarget(target: FindTarget): () => void {
	findTargets.set(target, ++seq);
	sync();
	return () => {
		if (findTargets.delete(target)) sync();
	};
}

/** Open the page's finder as Ctrl/Cmd+F would, for a visible Find control. Whether one opened. */
export function openFinder(): boolean {
	const finder = reachableFinder();
	finder?.open();
	return finder !== null;
}
// #endregion
