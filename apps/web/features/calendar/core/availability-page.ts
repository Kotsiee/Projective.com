import { signal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import {
	CALENDAR_ZOOM_DEFAULT,
	type CalendarViewMode,
	createSchedulerStore,
	type SchedulerPreset,
	type SchedulerStore,
} from "@projective/ui/calendar";
import { firstWeekdayOf } from "@projective/types/org";
import { dateInZone } from "@projective/types/scheduling";
import { workspaceSchedulerEngine } from "@features/catalogue/core/availability-conflict-store.ts";
import { working } from "@features/catalogue/core/availability-store.ts";

/**
 * availability-page — the state the regions of `/calendar?view=availability` share (Decision #377).
 *
 * The page's parts live in four islands — the header band (period, undo, redo, Go to now), the body
 * (the grid), the panel (settings, services, rules, the rule editor) and the footer band (layer, zoom,
 * Save) — so the grid's position and the scheduler's store cannot live in any one of them. These
 * signals are written only by a reader's actions in the browser, never during a server render, where
 * module state is shared by every request.
 */

/** The panel's element id, which the header band's toggle controls. */
export const AVAILABILITY_PANEL_ID = "cal-avpanel";

/** The focused instant, or `0` for now — the scheduler grid reads `0` as the present. */
export const availabilityFocus = signal(0);
/** Day · Week · Month for the scheduler grid. */
export const availabilityView = signal<CalendarViewMode>("week");
/** The scheduler grid's zoom; the footer band's ruler and the grid's Ctrl+wheel move it. */
export const availabilityZoom = signal(CALENDAR_ZOOM_DEFAULT);
/** Bumped by Go to now; the grid centres its now-line on each new value. */
export const availabilityPresent = signal(0);

/**
 * What the viewer's `org.user_preferences.locale` decides on this page: the weekday their week
 * starts on, which every region reads the same way — the weekday rail's order, the range calendar's
 * first column and the week a painted rule starts in. Only the ORDER: weekday and month names stay in
 * the product's language, as the rest of the calendar's do.
 */
export interface PageViewer {
	/** 0 = Sunday … 6 = Saturday, the `availability_rules.weekday` numbering. */
	weekStartsOn: number;
}

/** The {@link PageViewer} a locale implies; an absent or unreadable one starts on Monday. */
export function pageViewerOf(locale: string | null | undefined): PageViewer {
	return { weekStartsOn: firstWeekdayOf(locale) };
}

let shared: SchedulerStore | null = null;

/**
 * The one scheduler store every island of the page edits, so an undo in the header band, a rule
 * opened in the panel and a band painted on the grid are one history. Made by whichever island
 * hydrates first, from the template it opens on; each edit lands in the availability store's
 * `working`. A server render makes its own store per island instead.
 */
export function usePageScheduler(
	value: SchedulerPreset,
	viewer: PageViewer = pageViewerOf(null),
): SchedulerStore {
	return useMemo(() => {
		const make = () =>
			createSchedulerStore(value, workspaceSchedulerEngine, {
				today: dateInZone(Date.now(), value.timezone),
				weekStartsOn: viewer.weekStartsOn,
				onChange: (preset) => (working.value = preset),
			});
		if (typeof document === "undefined") return make();
		return (shared ??= make());
	}, []);
}
