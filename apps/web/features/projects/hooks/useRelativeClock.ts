import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { Signal } from "@preact/signals";

/**
 * useRelativeClock — a coarse "now" that advances on its own, for a label that ages.
 *
 * The setup footer's auto-save line reads "Last updated 4 minutes ago". Rendered once from
 * `Date.now()` it would say "just now" for the rest of the session, which is not a stale number so
 * much as a false statement — an owner who stepped away for an hour would come back to a form
 * telling them their work had saved a moment ago.
 *
 * ## Why a ticker rather than a timeout per label
 *
 * The obvious alternative is to schedule the next update for the exact moment the wording would
 * change. That is more precise and strictly worse here: the label's own thresholds live in
 * `core/save-status.ts`, so a timeout tuned to them would be a second copy of that rule expressed as
 * durations, and the two would drift the first time either was edited. A fixed coarse tick has no
 * opinion about the thresholds at all.
 *
 * ## Backgrounded tabs
 *
 * Engines throttle and coalesce timers in a hidden document, so a tab left in the background comes
 * back holding an instant from whenever the last tick was allowed to run. `visibilitychange` is
 * therefore watched alongside the interval — it costs one listener and it is the difference between
 * a correct label and one that is wrong by exactly as long as the reader was away, which is the
 * moment they are most likely to check it.
 *
 * @param intervalMs How often to advance. Defaults to 30s — twice the finest granularity the label
 * has (whole minutes), so a wording change is never more than a tick late.
 */
export function useRelativeClock(intervalMs = 30_000): Signal<number> {
	const now = useSignal(Date.now());

	useEffect(() => {
		const tick = () => {
			now.value = Date.now();
		};
		const timer = setInterval(tick, intervalMs);
		const onVisible = () => {
			if (document.visibilityState === "visible") tick();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [intervalMs]);

	return now;
}
