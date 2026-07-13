import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { attachDragScroll, pageScroll } from "./drag-scroll.ts";

/**
 * Shared carousel behaviour for the horizontal showcase tracks. Wires pointer drag-to-scroll onto the
 * track element and exposes signal-backed edge state (`atStart` / `atEnd`) so the Prev/Next controls
 * can disable themselves at the extremes — signal-first, no `useState` (root CLAUDE.md §3). Returns the
 * track ref, the two paging callbacks, and the edge signals.
 */
export function useCarousel() {
	const trackRef = useRef<HTMLDivElement>(null);
	const atStart = useSignal(true);
	const atEnd = useSignal(false);

	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;

		const sync = () => {
			const max = el.scrollWidth - el.clientWidth;
			atStart.value = el.scrollLeft <= 2;
			atEnd.value = el.scrollLeft >= max - 2;
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

	return { trackRef, prev, next, atStart, atEnd };
}
