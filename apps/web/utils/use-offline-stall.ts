import { type ReadonlySignal, type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { isOnline } from "./network.ts";
import { OFFLINE_NOTICE_TEXT } from "./offline.ts";

/**
 * The sentence for a page load that failed: the offline notice when the browser says it is offline,
 * otherwise the caller's own fallback. For the click-driven loaders ("Show more", "Load earlier")
 * that already own an error line and a button that doubles as the retry — the same words as the
 * infinite-scroll notice, so one failure reads the same way wherever it happens.
 */
export function offlineOr(fallback: string): string {
	return isOnline.peek() ? fallback : OFFLINE_NOTICE_TEXT;
}

/**
 * useOfflineStall — the one rule for a paginated list whose next page failed while offline.
 *
 * Every infinite-scroll surface in the app pages the same way: a sentinel (or a `Load more` press)
 * calls `loadMore`, the transport folds a failure into `{ ok: false }`, and the island appends. What
 * they did NOT share was an answer to "the page failed and the browser is offline": most fell
 * silent, one drew its own error strip. This hook is that answer, so all of them say the same
 * sentence with the same control — the `InlineNotice` at the list's loading edge — and so the
 * decision of when to say it lives in one place.
 *
 * ## What "blocked" gates
 *
 * While stalled, the consumer's `loadMore` guard returns early on `blocked`, so a sentinel that is
 * still in view does not re-fire the request on every intersection change and turn a dead
 * connection into a retry loop. Only two things lift it: the reader pressing Retry, and the
 * connection coming back (the offline→online edge, watched here) — in which case the retry is
 * automatic, because the sentinel is already in view and nothing else would ever trigger the load
 * again. `blocked` is `stalled && !retrying` rather than `stalled` itself so the notice STAYS
 * mounted, announced as busy, for the whole retry: clearing the stall first unmounted the notice
 * and re-mounted it 300 ms later when the retry failed too, a flicker that read as the page having
 * done something it had not.
 *
 * ## Why only the OFFLINE failure
 *
 * A failure while the browser believes it is online is a different fact (the server is unhappy, a
 * captive portal is lying) with a different remedy, and the surfaces that report it already do so in
 * their own words. This hook deliberately does not widen into a general error channel: a sentence
 * that says "offline" must only ever be printed when the browser has said so (`network.ts` trusts
 * that direction and only that direction).
 */
export interface OfflineStall {
	/** `true` while the last page failed offline — the notice renders while this holds. */
	stalled: Signal<boolean>;
	/** A retry is in flight (drives the notice's `busy`). */
	retrying: Signal<boolean>;
	/** What the consumer's `loadMore` guard checks: stalled and not currently retrying. */
	blocked: ReadonlySignal<boolean>;
	/**
	 * Record the outcome of a page load. Returns `true` when the list is now stalled, so a caller can
	 * skip its own generic error reporting for this case.
	 */
	settle(ok: boolean): boolean;
	/** The reader's (or the reconnection's) retry: loads again, keeping the notice up until it settles. */
	retry(): void;
}

/** @param loadMore The consumer's own page loader — called again on retry, unchanged. */
export function useOfflineStall(loadMore: () => Promise<void> | void): OfflineStall {
	const stalled = useSignal(false);
	const retrying = useSignal(false);
	const blocked = useComputed(() => stalled.value && !retrying.value);
	// The latest loader, so the reconnection effect (registered once) calls the current closure —
	// each render of the host island captures fresh signals and params in its `loadMore`.
	const loadRef = useRef(loadMore);
	loadRef.current = loadMore;

	const settle = (ok: boolean): boolean => {
		retrying.value = false;
		const now = !ok && !isOnline.peek();
		stalled.value = now;
		return now;
	};

	const retry = () => {
		if (retrying.peek()) return;
		retrying.value = true;
		const result = loadRef.current();
		// A loader that returned nothing (guarded out) has nothing to settle; do not leave the notice
		// announced as busy for a request that never started.
		if (!(result instanceof Promise)) retrying.value = false;
		else result.finally(() => (retrying.value = false));
	};

	useEffect(() => {
		let was = isOnline.peek();
		return isOnline.subscribe((online) => {
			if (online && !was && stalled.peek()) retry();
			was = online;
		});
		// The subscription reads the latest loader through the ref; nothing here changes identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { stalled, retrying, blocked, settle, retry };
}
