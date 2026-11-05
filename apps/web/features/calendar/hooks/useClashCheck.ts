import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ClashQuery, EventClash } from "@projective/types/scheduling";
import { ScheduleService } from "../core/ScheduleService.ts";

/** Long enough that dragging through a time picker asks once, on the time it stops at. */
const DEBOUNCE_MS = 300;

/**
 * What the reader's calendar already holds across a span, debounced as the span changes.
 *
 * A failed check clears nothing and says nothing: this is a warning beside a field, not a gate on it,
 * so a network hiccup should neither block a save nor raise an alarm. An answer that arrives after the
 * span has moved on is dropped.
 */
export function useClashCheck(query: ClashQuery): ReadonlySignal<EventClash[]> {
	const clashes = useSignal<EventClash[]>([]);
	const { start, end, excludeEventId } = query;

	useEffect(() => {
		// A moment has no span to clash with, as in `detectTimeClash`.
		if (end <= start) {
			clashes.value = [];
			return;
		}
		let stale = false;
		const timer = setTimeout(async () => {
			const res = await ScheduleService.clashes({ start, end, excludeEventId });
			if (!stale && res.ok && res.data) clashes.value = res.data.clashes;
		}, DEBOUNCE_MS);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [start, end, excludeEventId]);

	return clashes;
}
