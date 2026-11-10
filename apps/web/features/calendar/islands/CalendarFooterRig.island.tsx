import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/calendar-chrome.css";
import { CalendarZoom, timelinePxPerDayAt, timelineZoomFor } from "@projective/ui/calendar";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Button, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { LaneFilterChoices, LaneFilterFacet } from "@projective/ui/navigation";
import type { SchedulePage } from "@projective/types/scheduling";
import { CalendarExportPopover } from "../components/CalendarExportPopover.tsx";
import { CalendarImportPopover } from "../components/CalendarImportPopover.tsx";
import { ConnectCalendarDialog } from "../components/ConnectCalendarDialog.tsx";
import {
	calendarPage,
	calendarPreset,
	calendarSnapZoom,
	type CalendarSurface,
	calendarView,
	calendarZoom,
	connectOpen,
	importedEvents,
	PRESET_OPTIONS,
	requestCreate,
	setCalendarSnapZoom,
	timelineZoom,
} from "../core/calendar-state.ts";

/**
 * CalendarFooterRig — the middle-nav FOOTER band on every `/calendar` route, in three parts: the
 * display preset on the leading edge, the zoom ruler in the centre, and the surface's actions on the
 * trailing edge. The actions keep the anatomy of `/catalogue/[id]`'s rig: the secondaries are
 * icon-only ghost circles with a portal Tooltip each (Import · Export · Connect), and — below 767px
 * only, where the shell removes the lane whose footer carries it (Decision #378) — New event is the
 * band's one filled commit, last.
 *
 * **The preset** is a ghost circle that opens a one-choice menu over {@link calendarPreset}:
 * everything, availability only, hide availability, or booked holidays only. It is a lens over the
 * same agenda, so it narrows the grid and the lane's list together. The same menu holds the one zoom
 * preference, "Snap zoom to intervals" ({@link calendarSnapZoom}) — the calendar's display options.
 *
 * **The view control is one ruler** ({@link CalendarZoom}): Day · Week · Month on the calendar axis
 * and on through Quarter · Year on the timeline. The toggle between the two axes is the header band's
 * Timeline view (Decision #377). It drives {@link calendarZoom} / {@link timelineZoom}, which the body
 * hands to the engine, so the marker and the grid's Ctrl+wheel move one value.
 *
 * **The layer is mounted HERE, not in a route body**, because it belongs to whatever triggers it:
 * the connect modal and the import and export popovers open from this rig at every width.
 *
 * **The rig contains itself.** `container-type: inline-size` stops this `nowrap` row contributing its
 * min-content to the middle-nav's `minmax(0, 1fr)` content track and makes its tiers real container
 * queries. No tier removes a control: New event's word moves to its Tooltip, the stop name (already
 * the slider's spoken value) is dropped from view, and the narrowest rig wraps onto two rows.
 *
 * **A team's or business's calendar** (`surface="entity"`) is read-only — an entry is added on its own
 * project's calendar — and a connection is a person's, never an entity's, so its rig keeps the zoom
 * ruler, the display menu's snap preference and Export. The display presets are absent too: the union
 * carries no availability layer or leave for them to narrow to.
 */
export interface CalendarFooterRigProps {
	/** The SSR page — the export popover writes what the surface holds, so it needs the same data. */
	initial: SchedulePage | null;
	/** Same-origin path a consent round trip returns to. */
	returnTo: string;
	/** Which calendar the rig frames (default `personal`). */
	surface?: CalendarSurface;
}

/**
 * The ruler on its own, so a live zoom — which moves {@link calendarZoom} on every wheel event —
 * re-renders the ruler and not the whole rig with its popover, tooltips and buttons.
 */
function RigZoom(): JSX.Element {
	const timeline = calendarView.value === "timeline";
	return (
		<CalendarZoom
			class="cal-rig__zoom"
			snap={calendarSnapZoom.value}
			mode={timeline ? "timeline" : "calendar"}
			value={timeline ? timelineZoomFor(timelineZoom.value) : calendarZoom.value}
			onValueChange={(u) => {
				if (timeline) timelineZoom.value = timelinePxPerDayAt(u);
				else calendarZoom.value = u;
			}}
		/>
	);
}

const GHOST_CIRCLE = [
	"ui-button ui-button--secondary ui-button--text ui-button--size-sm",
	"ui-button--rounded ui-button--icon-only cal-rig__icon ui-hit",
].join(" ");

export default function CalendarFooterRig(props: CalendarFooterRigProps): JSX.Element {
	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const personal = (props.surface ?? "personal") === "personal";
	const presetOpen = useSignal(false);
	const preset = calendarPreset.value;
	const presetLabel = PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? "Everything";
	const displayLabel = personal ? `Show on the calendar: ${presetLabel}` : "Display options";

	return (
		<div class="cal-rig">
			<Popover
				open={presetOpen}
				placement="top-start"
				label={personal ? "Show on the calendar" : "Display options"}
				class="ui-lane-filter-pop"
				trigger={(api) => (
					<Tooltip
						content={personal ? `Showing: ${presetLabel}` : "Display options"}
						density="compact"
					>
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							class="cal-rig__icon cal-rig__preset ui-hit"
							data-on={preset === "all" ? undefined : "true"}
							triggerRef={api.ref}
							icon={<Icon name={preset === "all" ? "eye" : "eye-off"} size="sm" />}
							aria-label={displayLabel}
							aria-haspopup="dialog"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
						/>
					</Tooltip>
				)}
			>
				<div class="ui-lane-filter">
					{personal
						? (
							<LaneFilterChoices
								label="Show on the calendar"
								single
								options={PRESET_OPTIONS}
								active={[preset]}
								onToggle={(v) => {
									calendarPreset.value = v;
									presetOpen.value = false;
								}}
							/>
						)
						: null}
					<LaneFilterFacet label="Zoom">
						<ToggleSwitch
							size="sm"
							label="Snap zoom to intervals"
							value={calendarSnapZoom}
							onValueChange={setCalendarSnapZoom}
						/>
					</LaneFilterFacet>
				</div>
			</Popover>

			<RigZoom />

			<div class="cal-rig__actions">
				{personal
					? (
						<CalendarImportPopover
							timezone={tz}
							triggerClass={GHOST_CIRCLE}
							placement="top-end"
							iconSize="sm"
						/>
					)
					: null}
				<CalendarExportPopover
					events={[...(page?.events ?? []), ...importedEvents.value]}
					timezone={tz}
					calendarName={`Projective ${page?.title ?? "Calendar"}`}
					triggerClass={GHOST_CIRCLE}
					placement="top-end"
					iconSize="sm"
				/>
				{personal
					? (
						<>
							<Tooltip content="Connect a calendar" density="compact">
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
						</>
					)
					: null}
			</div>

			{personal ? <ConnectCalendarDialog open={connectOpen} returnTo={props.returnTo} /> : null}
		</div>
	);
}
