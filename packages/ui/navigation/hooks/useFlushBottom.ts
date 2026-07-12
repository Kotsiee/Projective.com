import type { RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

/**
 * Detects whether an element's bottom edge is flush with the viewport bottom (within `tolerance`px).
 *
 * Drives the Conditional Bottom-Left Curve (DESIGN_SYSTEM.md Part D): a nested frame flush to the
 * window bottom keeps a sharp bottom-left (maximizes area); if it terminates early — leaving a parent
 * track beneath — the bottom-left corner curves to match the top-left. Client-only (island).
 */
export function useFlushBottom(ref: RefObject<HTMLElement>, tolerance = 1): boolean {
	const flush = useSignal(true);
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const measure = () => {
			const rect = el.getBoundingClientRect();
			flush.value = Math.abs(rect.bottom - globalThis.innerHeight) <= tolerance;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		globalThis.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			globalThis.removeEventListener("resize", measure);
		};
	}, [ref, tolerance]);
	return flush.value;
}
