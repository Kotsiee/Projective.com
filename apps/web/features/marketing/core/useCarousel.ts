import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { attachDragScroll, pageScroll } from "./drag-scroll.ts";

/**
 * Shared carousel behaviour for the horizontal showcase tracks. Wires pointer drag-to-scroll onto the
 * track element and exposes signal-backed edge state (`atStart` / `atEnd`) so the Prev/Next controls
 * can disable themselves at the extremes — signal-first, no `useState` (root CLAUDE.md §3). Returns the
 * track ref, the two paging callbacks, the edge signals, and the scroll `progress`.
 *
 * `progress` is the fraction of the scrollable distance already travelled, 0→1. It comes free: the
 * denominator it needs (`scrollWidth - clientWidth`) was already being computed inside `sync()` to
 * decide `atEnd`, and then discarded. It updates on every native `scroll` event — which includes the
 * drag pan and the release fling, because `attachDragScroll` writes `scrollLeft` directly rather than
 * transforming the track, so an indicator reading it stays in step with no second rAF loop.
 *
 * A track with nothing to scroll reports `0`, not `1`. "You have seen all of it" and "there is only
 * one screen of it" are different statements, and a consumer that wants the second one can ask
 * `atStart.value && atEnd.value`.
 */
export function useCarousel() {
	const trackRef = useRef<HTMLDivElement>(null);
	const atStart = useSignal(true);
	const atEnd = useSignal(false);
	const progress = useSignal(0);

	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;

		const sync = () => {
			const max = el.scrollWidth - el.clientWidth;
			atStart.value = el.scrollLeft <= 2;
			atEnd.value = el.scrollLeft >= max - 2;
			// `scrollLeft` runs negative in an RTL track in this engine, so the ratio is taken on the
			// absolute distance travelled — progress means "how far through", never "which way".
			progress.value = max > 0 ? Math.min(1, Math.abs(el.scrollLeft) / max) : 0;
		};

		sync();
		el.addEventListener("scroll", sync, { passive: true });
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		const dispose = attachDragScroll(el);

		return () => {
			el.removeEventListener("scroll", sync);
			ro.disconnect();
			dispose();
		};
	}, []);

	const prev = () => trackRef.current && pageScroll(trackRef.current, -1);
	const next = () => trackRef.current && pageScroll(trackRef.current, 1);

	return { trackRef, prev, next, atStart, atEnd, progress };
}
