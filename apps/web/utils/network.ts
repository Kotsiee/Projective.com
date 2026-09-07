import { signal } from "@preact/signals";

/**
 * network — whether this browser currently has a connection, as one shared signal.
 *
 * Every surface that has to behave differently offline reads the SAME signal rather than binding its
 * own pair of listeners. Two independent readers would each hold their own copy of the answer, and
 * the copies would disagree for as long as it took the second listener to fire — which is precisely
 * the moment a surface is deciding whether to send a write.
 *
 * ## `navigator.onLine` is a floor, not a verdict
 *
 * It reports whether the machine has *a* network interface up, not whether this origin is reachable:
 * a captive portal, a VPN that has dropped its tunnel and a server that is simply down all read
 * `true`. So it is used in ONE direction only — a `false` is trusted (there is genuinely nowhere to
 * send anything), and a `true` is treated as "worth trying", never as a guarantee.
 *
 * There is deliberately no `markUnreachable` counterpart to {@link markReachable}. A caller cannot
 * tell a transport failure from a server error — `fetch` rejects for the first, and the app's own
 * `api.ts` folds both into the same soft `{ ok: false }` — so a function that let a failed request
 * declare the whole app offline would fire on every 500 and put a working browser into a state
 * whose only exit is an `online` event that is never going to arrive. Callers that must not lose a
 * write handle the ambiguity where they can see it; see `projects/core/setup-state.ts`'s flush.
 *
 * ## Optimistic default
 *
 * The signal starts `true`, including during SSR where `navigator` does not exist. A surface that
 * paints "offline" on the server and corrects itself on hydration would flash a failure state at
 * every reader on every load, and the overwhelmingly common case is that there is a connection.
 * {@link watchNetwork} re-reads the real value the moment it mounts.
 */

// #region State
/** `true` while the browser believes this page can reach the network. */
export const isOnline = signal<boolean>(true);
// #endregion

// #region Transitions
/** Move the signal. Idempotent, so a redundant `online` event costs no re-render. */
function setOnline(next: boolean): void {
	if (isOnline.peek() === next) return;
	isOnline.value = next;
}

/**
 * Report that a request completed.
 *
 * The cheapest possible proof the origin is reachable, and the one direction that IS safe to infer
 * from a request: a response arrived, so there was a route. Worth having because `navigator.onLine`
 * can lag a reconnection by seconds on some platforms, and a surface holding a queued write should
 * not wait for the event when it already has the answer in its hands.
 */
export function markReachable(): void {
	setOnline(true);
}
// #endregion

// #region Subscription
/**
 * Track the browser's connection and keep {@link isOnline} in step. Returns its own unsubscribe.
 *
 * Called by whichever island needs the fact; safe to call from several at once, because every caller
 * writes the same value into the same signal and the listeners are per-call.
 *
 * `visibilitychange` is watched alongside `online`/`offline` because a tab that was backgrounded
 * across an outage may never have been given the `online` event at all — some engines coalesce or
 * drop them for hidden documents. Re-reading on the way back is what stops a tab coming out of the
 * background convinced it is still offline and queueing writes it could send.
 */
export function watchNetwork(): () => void {
	if (typeof globalThis.addEventListener !== "function") return () => {};

	const sync = () => {
		// `navigator` is absent under SSR and in a worker without it; treat that as online, per the
		// optimistic default above.
		const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
		setOnline(nav?.onLine !== false);
	};

	sync();

	const onVisible = () => {
		if (document.visibilityState === "visible") sync();
	};

	globalThis.addEventListener("online", sync);
	globalThis.addEventListener("offline", sync);
	document.addEventListener("visibilitychange", onVisible);

	return () => {
		globalThis.removeEventListener("online", sync);
		globalThis.removeEventListener("offline", sync);
		document.removeEventListener("visibilitychange", onVisible);
	};
}
// #endregion
