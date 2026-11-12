import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { CalendarAddress } from "../core/calendar-address.ts";
import {
	calendarView,
	calendarZoom,
	persistCalendarView,
	persistCalendarZoom,
	restoreCalendarView,
	timelineZoom,
} from "../core/calendar-state.ts";

/**
 * Restore the reader's calendar view and zoom on mount, and remember each change after it — for a body
 * that drives the engine from `calendar-state` while the footer band holds the view control
 * (`/calendar`, and a team's or business's calendar, which share the stored values).
 *
 * The stored values are the reader's DEFAULT: whatever `address` names (Decision #413) is left as the
 * address installed it. The first run of each remembering effect is skipped: it fires with the value
 * the signal was built with, which would be written over the one {@link restoreCalendarView} is in the
 * middle of installing.
 */
export function useCalendarViewMemory(address: CalendarAddress = {}): void {
	useEffect(() => {
		restoreCalendarView(address);
	}, []);

	const viewSettled = useSignal(false);
	useEffect(() => {
		if (!viewSettled.value) {
			viewSettled.value = true;
			return;
		}
		persistCalendarView(calendarView.value);
	}, [calendarView.value]);

	const zoomSettled = useSignal(false);
	useSignalEffect(() => {
		calendarZoom.value;
		timelineZoom.value;
		if (!zoomSettled.peek()) {
			zoomSettled.value = true;
			return;
		}
		persistCalendarZoom();
	});
}
