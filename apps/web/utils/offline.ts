/**
 * offline — the pure rules behind the app's offline handling: which clicks are internal navigations
 * worth intercepting, which requests are user-facing writes worth refusing, and the one envelope a
 * refused write answers with.
 *
 * Everything here is total and DOM-free so it can be unit-tested, and so the two places that act on
 * it — the global guards in `offline-guards.ts` (installed by the `OfflineBridge` island) and the
 * centralised `apiFetch` client — cannot disagree about what counts as a write or a navigation. The verdicts are
 * deliberately conservative in both directions:
 *
 * - A navigation is intercepted ONLY when it is unambiguously "open a different page of this site in
 *   this tab". A modified click, a `target`, a `download`, a same-document fragment and a
 *   cross-origin link all keep their native behaviour, because the browser (and the service worker's
 *   fallback page) already handle those correctly and a guard that second-guesses them is a guard
 *   that breaks an open-in-new-tab.
 * - A request is refused ONLY when it is a same-origin, user-initiated write. Reads pass through
 *   (their failure is the surface's to report — see the paginated lists), cross-origin traffic is
 *   not this app's to judge, and background/telemetry traffic (`keepalive`, the log beacon path, an
 *   explicit background marker) must never produce a user-facing refusal.
 */

// #region Copy
/** The interstitial's title — a navigation refused because nothing is stored for the page. */
export const OFFLINE_NAV_TITLE = "You are offline";

/** The interstitial's body. Matches the service worker's inline fallback word for word. */
export const OFFLINE_NAV_BODY =
	"This page has not been opened on this device yet, so there is nothing stored to show you. " +
	"Anything you have already edited is saved here and will sync when you reconnect.";

/** The refusal a user-facing write receives while offline (the `message` of the envelope). */
export const OFFLINE_WRITE_MESSAGE =
	"You are offline — that change was not sent. Reconnect and try again.";

/** The inline notice a paginated list appends when its next page failed while offline. */
export const OFFLINE_NOTICE_TEXT = "You are currently offline.";

/** The status strip's statement while the connection is gone. */
export const OFFLINE_RIBBON_TEXT =
	"You are offline — some actions are unavailable until you reconnect.";

/** The status strip's statement in the moments after the connection returns. */
export const ONLINE_RIBBON_TEXT = "Back online.";
// #endregion

// #region Requests
/** The verbs that change something. Everything else is treated as a read. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Request paths that are BACKGROUND traffic: a refusal there must never reach the user.
 *
 * The production logger already beacons to `/api/logs` through `navigator.sendBeacon`, which this
 * guard never sees; the path is listed anyway so a future `fetch`-based batch stays silent too.
 */
export const BACKGROUND_PATHS: readonly string[] = [
	"/api/logs",
	"/api/telemetry",
	"/api/analytics",
];

/**
 * A request header a caller sets to mark a write as background work — a heartbeat, a metric, a
 * prefetch — that should fail quietly rather than be refused with a notice.
 */
export const BACKGROUND_HEADER = "x-pj-background";

/** Whether `method` (any case) is one of the {@link MUTATING_METHODS}. */
export function isMutatingMethod(method: string | undefined): boolean {
	return MUTATING_METHODS.has((method ?? "GET").toUpperCase());
}

/** The shape of a request the guard decides on — extracted from `fetch`'s arguments by the caller. */
export interface RequestFacts {
	/** The resolved absolute URL. */
	url: URL;
	/** The verb, any case. */
	method: string;
	/** `RequestInit.keepalive` / `Request.keepalive` — a beacon-style send. */
	keepalive: boolean;
	/** The value of {@link BACKGROUND_HEADER}, if the caller set it. */
	backgroundHeader: string | null;
}

/**
 * Whether these facts describe traffic the offline guard must leave alone.
 *
 * Any one of: a `keepalive` send, the explicit background marker, or a path on the background list.
 */
export function isBackgroundRequest(facts: RequestFacts): boolean {
	if (facts.keepalive) return true;
	if (facts.backgroundHeader !== null && facts.backgroundHeader !== "0") return true;
	return BACKGROUND_PATHS.some((p) =>
		facts.url.pathname === p || facts.url.pathname.startsWith(p + "/")
	);
}

/**
 * The verdict: refuse this request while offline?
 *
 * `true` only for a same-origin, mutating, user-facing request. `origin` is passed in rather than
 * read from `location` so the rule is testable and so a request the app makes against another origin
 * (a signed storage upload) keeps its own failure path.
 */
export function shouldRefuseWhileOffline(facts: RequestFacts, origin: string): boolean {
	if (facts.url.origin !== origin) return false;
	if (!isMutatingMethod(facts.method)) return false;
	if (isBackgroundRequest(facts)) return false;
	return true;
}

/** Read one header from any `HeadersInit` shape, case-insensitively. `null` when absent. */
export function readHeader(headers: HeadersInit | undefined, name: string): string | null {
	if (!headers) return null;
	if (headers instanceof Headers) return headers.get(name);
	const wanted = name.toLowerCase();
	if (Array.isArray(headers)) {
		for (const [key, value] of headers) if (key.toLowerCase() === wanted) return value;
		return null;
	}
	const record = headers as Record<string, string>;
	for (const key of Object.keys(record)) {
		if (key.toLowerCase() === wanted) return record[key];
	}
	return null;
}

/**
 * Resolve the facts of a `fetch(input, init)` call. `base` resolves a relative URL (the app's own
 * routes are always relative) and doubles as the origin the verdict compares against.
 *
 * `init` wins over a `Request` input for the method and headers, which is `fetch`'s own precedence.
 */
export function requestFacts(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	base: string,
): RequestFacts {
	const isRequest = typeof Request !== "undefined" && input instanceof Request;
	const rawUrl = typeof input === "string"
		? input
		: input instanceof URL
		? input.href
		: (input as Request).url;
	const url = new URL(rawUrl, base);
	const method = init?.method ?? (isRequest ? (input as Request).method : "GET");
	const keepalive = init?.keepalive ?? (isRequest ? (input as Request).keepalive : false);
	const backgroundHeader = readHeader(init?.headers, BACKGROUND_HEADER) ??
		(isRequest ? (input as Request).headers.get(BACKGROUND_HEADER) : null);
	return { url, method, keepalive: keepalive === true, backgroundHeader };
}

/** The JSON body a refused write answers with — the app's own `{ ok, message }` envelope. */
export interface OfflineRefusalBody {
	ok: false;
	message: string;
	/** A machine-readable marker so a caller that wants to special-case the offline refusal can. */
	code: "offline";
}

/**
 * The synthetic response for a write refused while offline.
 *
 * A `Response` rather than a rejection, on purpose: every feature transport folds a rejection into a
 * generic "Network error" while it forwards a JSON envelope's `message` verbatim, so answering with
 * the envelope is what lets the surface say WHY. `503` is the honest status (the service is
 * unavailable from here), and `no-store` keeps any intermediary from ever remembering it.
 */
export function offlineWriteResponse(): Response {
	const body: OfflineRefusalBody = { ok: false, message: OFFLINE_WRITE_MESSAGE, code: "offline" };
	return new Response(JSON.stringify(body), {
		status: 503,
		statusText: "Offline",
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"x-pj-offline": "1",
		},
	});
}
// #endregion

// #region Navigation
/** The facts of a click on an anchor, extracted from the DOM by the caller. */
export interface NavigationClickFacts {
	/** The anchor's resolved `href`. */
	href: string;
	/** `target` attribute (empty when unset). */
	target: string;
	/** Whether the anchor carries a `download` attribute. */
	download: boolean;
	/** Mouse button (`0` = primary). */
	button: number;
	/** Any of ctrl/meta/shift/alt held. */
	modified: boolean;
	/** Whether some handler already prevented the default. */
	defaultPrevented: boolean;
	/** `data-offline-allow` set on the anchor — an opt-out for a link that must always go native. */
	optedOut: boolean;
}

/**
 * Whether this click is an internal page navigation the offline guard should own.
 *
 * Returns the destination when it is, `null` otherwise. `current` is the document's own URL: a
 * same-document fragment jump and a link to the exact page are left alone (nothing to fetch), as is
 * anything under `/api/` (a download link, not a page).
 */
export function internalNavigationOf(facts: NavigationClickFacts, current: string): URL | null {
	if (facts.defaultPrevented || facts.optedOut) return null;
	if (facts.button !== 0 || facts.modified) return null;
	if (facts.download) return null;
	if (facts.target && facts.target !== "_self") return null;

	let dest: URL;
	let here: URL;
	try {
		here = new URL(current);
		dest = new URL(facts.href, current);
	} catch {
		return null;
	}
	if (dest.protocol !== "http:" && dest.protocol !== "https:") return null;
	if (dest.origin !== here.origin) return null;
	if (dest.pathname.startsWith("/api/")) return null;
	// The same document: a fragment jump, or a plain re-click of the current address. Either resolves
	// without a fetch, so there is nothing for the guard to refuse.
	if (dest.pathname === here.pathname && dest.search === here.search) return null;
	return dest;
}
// #endregion
