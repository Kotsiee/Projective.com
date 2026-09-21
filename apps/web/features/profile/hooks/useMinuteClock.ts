import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

const MINUTE_MS = 60_000;

/**
 * The clock the profile's live facts are derived from — the "Available now ⁄ Away" badge and the
 * seller's local time — as an epoch-ms signal that advances on every MINUTE BOUNDARY (a timer
 * aligned to `:00`, not a 60-second drift that would let the readout lag the wall clock by up to a
 * minute) and on tab re-focus, so a page left open overnight shows the right badge in the morning.
 *
 * One hook, because the context bar's availability block and the sticky header band both print
 * these facts, and two clocks that tick on different schedules would let the two disagree for up
 * to a minute at every boundary.
 */
export function useMinuteClock(): Signal<number> {
	const now = useSignal(Date.now());

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			now.value = Date.now();
			timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
		};
		tick();
		const onVisible = () => {
			if (document.visibilityState === "visible") now.value = Date.now();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, []);

	return now;
}
