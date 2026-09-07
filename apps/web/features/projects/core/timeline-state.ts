import { signal } from "@preact/signals";
import {
	clampZoom,
	type GanttCommand,
	PX_PER_DAY_DEFAULT,
	ZOOM_RANGE_DEFAULT,
} from "@projective/ui/gantt";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * Timeline view-state — the cross-island bridge between the middle-nav footer band (the
 * `TimelineControlRig` island: Today · Fit · zoom · Create Ticket / Create Stage) and the timeline
 * body (the `ProjectTimeline` island, which owns the Gantt + the ticket modal). They are separate
 * hydration boundaries, so — exactly like the board's `board-state.ts` — they coordinate through
 * module-level signals: the footer publishes intents and the zoom, the body publishes what it can do
 * and what the scale is currently divided into. Reset on unmount so a later navigation starts clean.
 */

// #region Zoom (persisted)
/** The time scale in px per day — the ONE zoom both the wheel gesture and the footer slider write. */
export const timelineZoom = signal<number>(PX_PER_DAY_DEFAULT);

let restored = false;
/** Restore the persisted zoom once (client-only, on first island mount) — no hydration flash. */
export function restoreTimelineZoom(): void {
	if (restored) return;
	restored = true;
	const raw = readStored("local", LocalKeys.TIMELINE_ZOOM);
	const n = raw ? Number(raw) : NaN;
	if (Number.isFinite(n) && n > 0) timelineZoom.value = clampZoom(n, ZOOM_RANGE_DEFAULT);
}

/**
 * Write the zoom (from either owner) and remember it.
 *
 * Persisted UNCONDITIONALLY, not only when the signal changes: the engine's own gestures (a wheel
 * zoom, the Fit command) write the host signal directly and then report through `onZoomChange`, so
 * by the time this runs the signal already holds the value — an "only if changed" guard would skip
 * exactly the writes the engine makes, and the reader's zoom would survive a reload only when the
 * slider had set it.
 */
export function setTimelineZoom(pxPerDay: number): void {
	const next = clampZoom(pxPerDay, ZOOM_RANGE_DEFAULT);
	if (next !== timelineZoom.peek()) timelineZoom.value = next;
	writeStored("local", LocalKeys.TIMELINE_ZOOM, String(Math.round(next * 100) / 100));
}
// #endregion

// #region Footer → body intents
/** One-shot engine commands (Today · Fit). The engine consumes and clears them. */
export const timelineCommands = signal<GanttCommand | null>(null);
/** Open the ticket-creation modal (footer Create Ticket). Consumed + reset by the body. */
export const timelineCreateTicket = signal<boolean>(false);
/** Open the Create-Stage modal (footer Create Stage — project scope only). Consumed + reset by the body. */
export const timelineCreateStage = signal<boolean>(false);

export function requestTimelineToday(): void {
	timelineCommands.value = { kind: "today" };
}
export function requestTimelineFit(): void {
	timelineCommands.value = { kind: "fit" };
}
export function requestTimelineCreateTicket(): void {
	timelineCreateTicket.value = true;
}
export function requestTimelineCreateStage(): void {
	timelineCreateStage.value = true;
}
// #endregion

// #region Body → footer capabilities
/** What the footer needs to know to render the right controls, published by the body. */
export interface TimelineCaps {
	/** The acting user is the client — gates Create Ticket / Create Stage. */
	isClient: boolean;
	/** The whole-engagement timeline (vs one stage's) — gates Create Stage. */
	isProjectScope: boolean;
	/** Whether this engagement has tickets at all (a session is booked, not ticketed). */
	hasTickets: boolean;
	/** Whether anything is dated at all — the Fit control has nothing to fit otherwise. */
	hasRange: boolean;
	/** Tickets carrying no date, drawn nowhere — the rig says so rather than leaving them missing. */
	undatedCount: number;
}

const EMPTY_CAPS: TimelineCaps = {
	isClient: false,
	isProjectScope: true,
	hasTickets: true,
	hasRange: false,
	undatedCount: 0,
};

export const timelineCaps = signal<TimelineCaps>(EMPTY_CAPS);

export function publishTimelineCaps(caps: TimelineCaps): void {
	timelineCaps.value = caps;
}

/**
 * The unit the header's scale is currently divided into ("Weeks", "Days"), published by the body as
 * the zoom moves so the rig's slider can name what it is doing.
 */
export const timelineTier = signal<string>("");

/** Reset every footer↔body signal (the body calls this on unmount). */
export function resetTimelineState(): void {
	timelineCommands.value = null;
	timelineCreateTicket.value = false;
	timelineCreateStage.value = false;
	timelineCaps.value = EMPTY_CAPS;
	timelineTier.value = "";
}
// #endregion
