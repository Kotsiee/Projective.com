import type { JSX } from "preact";
import "../styles/calendar-chrome.css";
import { CalendarZoom, timelinePxPerDayAt, timelineZoomFor } from "@projective/ui/calendar";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { SchedulePage } from "@projective/types/scheduling";
import { CalendarExportModal } from "../components/CalendarExportModal.tsx";
import { CalendarImportPopover } from "../components/CalendarImportPopover.tsx";
import { ConnectCalendarDialog } from "../components/ConnectCalendarDialog.tsx";
import {
	calendarPage,
	calendarView,
	calendarZoom,
	connectOpen,
	exportOpen,
	importedEvents,
	requestCreate,
	setCalendarMode,
	timelineZoom,
} from "../core/calendar-state.ts";

/**
 * CalendarFooterRig — the middle-nav FOOTER band on every `/calendar` route: the view control, the
 * surface's actions, and the action layer they open. The anatomy of `/catalogue/[id]`'s rig: the
 * secondaries are icon-only ghost circles with a portal Tooltip each (Import · Export · Connect), and
 * New event is the band's one filled commit, last, on the trailing edge.
 *
 * **The view control is one zoom slider** ({@link CalendarZoom}): Month · Week · Day on the calendar
 * axis and Year · Quarter · Month · Week · Day on the timeline, with a mark at every boundary and a
 * ghost toggle between the two axes. It drives {@link calendarZoom} / {@link timelineZoom}, which the
 * body hands to the engine, so the handle and the grid's Ctrl+wheel move one value.
 *
 * **The layer is mounted HERE, not in a route body**, because it belongs to whatever triggers it:
 * the connect modal and the export modal open from this rig at every width.
 *
 * **The rig contains itself.** `container-type: inline-size` stops this `nowrap` row contributing its
 * min-content to the middle-nav's `minmax(0, 1fr)` content track and makes its tiers real container
 * queries. No tier removes a control: New event's word moves to its Tooltip, the stop name (already
 * the slider's spoken value) is dropped from view, and the narrowest rig wraps onto two rows.
 */
export interface CalendarFooterRigProps {
	/** The SSR page — the export modal writes what the surface holds, so it needs the same data. */
	initial: SchedulePage | null;
	/** Same-origin path a consent round trip returns to. */
	returnTo: string;
}

const GHOST_CIRCLE = [
	"ui-button ui-button--secondary ui-button--text ui-button--size-sm",
	"ui-button--rounded ui-button--icon-only cal-rig__icon ui-hit",
].join(" ");

export default function CalendarFooterRig(props: CalendarFooterRigProps): JSX.Element {
	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const timeline = calendarView.value === "timeline";

	return (
		<div class="cal-rig">
			<CalendarZoom
				class="cal-rig__zoom"
				mode={timeline ? "timeline" : "calendar"}
				value={timeline ? timelineZoomFor(timelineZoom.value) : calendarZoom.value}
				onValueChange={(u) => {
					if (timeline) timelineZoom.value = timelinePxPerDayAt(u);
					else calendarZoom.value = u;
				}}
				onModeChange={setCalendarMode}
			/>

			<div class="cal-rig__actions">
				<CalendarImportPopover
					timezone={tz}
					triggerClass={GHOST_CIRCLE}
					placement="top-end"
					iconSize="sm"
				/>
				<Tooltip content="Export calendar">
					<Button
						iconOnly
						rounded
						size="sm"
						variant="text"
						severity="secondary"
						class="cal-rig__icon ui-hit"
						icon={<Icon name="download" size="sm" />}
						aria-label="Export calendar"
						aria-haspopup="dialog"
						onClick={() => (exportOpen.value = true)}
					/>
				</Tooltip>
				<Tooltip content="Connect a calendar">
					<Button
						iconOnly
						rounded
						size="sm"
						variant="text"
						severity="secondary"
						class="cal-rig__icon ui-hit"
						icon={<Icon name="link" size="sm" />}
						aria-label="Connect a calendar"
						aria-haspopup="dialog"
						onClick={() => (connectOpen.value = true)}
					/>
				</Tooltip>
				<Tooltip content="New event">
					<Button
						size="sm"
						label="New event"
						icon={<Icon name="plus" size="sm" />}
						class="cal-rig__create"
						aria-label="New event"
						onClick={requestCreate}
					/>
				</Tooltip>
			</div>

			<ConnectCalendarDialog open={connectOpen} returnTo={props.returnTo} />
			<CalendarExportModal
				events={[...(page?.events ?? []), ...importedEvents.value]}
				timezone={tz}
				calendarName={`Projective ${page?.title ?? "Calendar"}`}
			/>
		</div>
	);
}
