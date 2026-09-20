/// <reference lib="dom" />

import { isOnline } from "./network.ts";
import {
	internalNavigationOf,
	OFFLINE_WRITE_MESSAGE,
	offlineWriteResponse,
	requestFacts,
	shouldRefuseWhileOffline,
} from "./offline.ts";
import { refuseNavigation, reportWriteRefused } from "./offline-state.ts";
import { CacheKeys } from "./storage-keys.ts";

/**
 * offline-guards — the two client-side interceptions that make "offline" a state the app handles
 * rather than one the browser handles for it: a delegated click listener that owns internal
 * navigations, and a `fetch` wrapper that refuses user-facing writes. Both are installed ONCE, by the
 * `OfflineBridge` island, and both decide with the pure rules in `offline.ts`.
 *
 * ## Why a delegated listener and a global wrapper, not a `Link` component and a new client
 *
 * The app has ~1,500 anchors and a dozen feature transports, several of which still call `fetch`
 * directly. A component or a client that had to be adopted at every site would be correct exactly
 * where somebody remembered it and silently native everywhere else — and "everywhere else" is where
 * the next surface is written. One `document` listener sees every anchor that exists today and every
 * one added tomorrow; one wrapper sees every request, including the ones made by code that never
 * heard of `apiFetch`.
 *
 * ## What is left to the service worker on purpose
 *
 * A navigation the listener never sees — a programmatic `location.assign`, a native form submission,
 * a click an island stopped propagating, a cold load — still reaches the network, and `sw.js`
 * answers it from the shell cache or with its inline fallback page. That page is not superseded by
 * the interstitial here; it is the floor beneath it, for the cases no in-page code can catch.
 */

// #region Connectivity
/**
 * The trusted-`false` reading (see `network.ts`): offline when the shared signal OR the browser
 * says so. Reading both closes the gap in which the `offline` event has fired but no island has yet
 * folded it into the signal.
 */
export function browserIsOffline(): boolean {
	const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
	return isOnline.peek() === false || nav?.onLine === false;
}
// #endregion

// #region Shell cache
/**
 * Whether the service worker holds a copy of this document.
 *
 * Mirrors `sw.js`'s own lookup exactly — the full URL, then the bare pathname — because the guard is
 * asking the question the worker will be asked a moment later, and two answers to it are one too
 * many. Resolves `false` on every failure path: no `caches` (an insecure origin, some embedded
 * webviews), a bucket that does not exist yet (the first visit), a storage error. A `false` here
 * costs one interstitial; a `true` that was wrong would navigate the reader onto the worker's
 * fallback page, which is exactly the surprise the interstitial exists to prevent.
 */
export async function hasCachedDocument(dest: URL): Promise<boolean> {
	const storage = (globalThis as { caches?: CacheStorage }).caches;
	if (!storage) return false;
	try {
		if (!(await storage.has(CacheKeys.SHELL_CACHE))) return false;
		const cache = await storage.open(CacheKeys.SHELL_CACHE);
		const stored = (await cache.match(dest.href, { ignoreVary: true })) ??
			(await cache.match(dest.pathname, { ignoreVary: true }));
		return stored !== undefined;
	} catch {
		return false;
	}
}
// #endregion

// #region Navigation guard
/** The selector for a navigation-bearing anchor, HTML or SVG. */
const ANCHOR_SELECTOR = "a[href]";

/**
 * Install the delegated navigation guard. Returns its own uninstaller.
 *
 * BUBBLE phase on `document`, deliberately, and after every island's own handler: an island that
 * already called `preventDefault()` on a click (a card whose anchor opens a drawer instead) has made
 * its decision and the guard honours it, which the capture phase could not know yet. The cost is
 * that a handler which STOPS propagation hides the click from the guard entirely — that navigation
 * goes native and lands on the worker's fallback page, which is the documented floor.
 *
 * The default is prevented SYNCHRONOUSLY, before the cache is consulted, because the lookup is
 * async and a navigation cannot be un-started. When the document turns out to be stored, the guard
 * performs the navigation itself; when it is not, it records the destination and the interstitial
 * opens. Nothing here fetches.
 */
export function installOfflineNavigationGuard(): () => void {
	if (typeof document === "undefined") return () => {};

	const onClick = (event: MouseEvent) => {
		if (!browserIsOffline()) return;
		const origin = event.target;
		if (!(origin instanceof Element)) return;
		const anchor = origin.closest(ANCHOR_SELECTOR);
		if (!anchor) return;

		const href = anchor.getAttribute("href");
		if (href === null) return;
		const dest = internalNavigationOf({
			href,
			target: anchor.getAttribute("target") ?? "",
			download: anchor.hasAttribute("download"),
			button: event.button,
			modified: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
			defaultPrevented: event.defaultPrevented,
			optedOut: anchor.hasAttribute("data-offline-allow"),
		}, location.href);
		if (!dest) return;

		event.preventDefault();
		void hasCachedDocument(dest).then((cached) => {
			// The connection may have come back during the lookup; either way a stored page is safe to
			// open, and an unstored one is only safe once there is a network to fetch it from.
			if (cached || !browserIsOffline()) location.assign(dest.href);
			else refuseNavigation(dest);
		});
	};

	document.addEventListener("click", onClick);
	return () => document.removeEventListener("click", onClick);
}
// #endregion

// #region Fetch guard
/**
 * Decide a single `fetch` call while offline. `null` means "not this guard's business — send it".
 *
 * Shared by the global wrapper and by `apiFetch`, which short-circuits through it directly so the
 * centralised client is correct even on a page where the wrapper has not been installed yet
 * (island hydration order is not something either may assume).
 */
export function refuseOfflineWrite(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Response | null {
	if (!browserIsOffline()) return null;
	if (typeof location === "undefined") return null;
	let refuse = false;
	try {
		refuse = shouldRefuseWhileOffline(requestFacts(input, init, location.href), location.origin);
	} catch {
		// An unparseable URL is the native `fetch`'s error to raise, not this guard's to swallow.
		return null;
	}
	if (!refuse) return null;
	reportWriteRefused(OFFLINE_WRITE_MESSAGE);
	return offlineWriteResponse();
}

/** The wrapper currently installed, and how many installers are holding it. */
let installed: { native: typeof fetch; guarded: typeof fetch; holders: number } | null = null;

/**
 * Wrap `globalThis.fetch` so a user-facing write is refused while offline. Returns its uninstaller.
 *
 * Reference-counted rather than boolean so two installers (a test and the bridge, two bridges during
 * an HMR remount) restore the native function only when the LAST one lets go; the wrapper itself is
 * installed once, so a request is never inspected twice. Reads, cross-origin traffic and background
 * sends pass straight through to the native `fetch` and fail — or not — exactly as they always did.
 */
export function installOfflineFetchGuard(): () => void {
	if (typeof globalThis.fetch !== "function") return () => {};

	if (!installed) {
		const native = globalThis.fetch;
		const guarded: typeof fetch = function (this: unknown, input, init) {
			const refused = refuseOfflineWrite(input, init);
			if (refused) return Promise.resolve(refused);
			return native.call(this ?? globalThis, input, init);
		};
		globalThis.fetch = guarded;
		installed = { native, guarded, holders: 0 };
	}
	const mine = installed;
	mine.holders += 1;

	let released = false;
	return () => {
		if (released) return;
		released = true;
		mine.holders -= 1;
		if (mine.holders > 0 || installed !== mine) return;
		// Only put the native function back if nothing else has wrapped ours in the meantime — a
		// later wrapper would be lost otherwise, which is worse than leaving a harmless pass-through.
		if (globalThis.fetch === mine.guarded) globalThis.fetch = mine.native;
		installed = null;
	};
}
// #endregion
