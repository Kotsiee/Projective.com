import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { scrollBehaviorFor } from "@projective/ui/calendar";
import {
	LaneCollapseButton,
	LaneCreateButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
} from "@projective/ui/navigation";
import { DndContext, type DragEndEvent, DragOverlay, useDraggable } from "@projective/ui/dnd";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { CalendarEvent, SchedulePage } from "@projective/types/scheduling";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { AgendaFilters } from "../components/AgendaFilters.tsx";
import { AgendaRow, type AgendaRowProps, agendaRowTitle } from "../components/AgendaRow.tsx";
import {
	ENTRY_DRAG,
	LooseEntries,
	RoutineSection,
	routineTarget,
} from "../components/RoutineSection.tsx";
import { calendarModeHref } from "../core/availability-view.ts";
import {
	activeFilterCount,
	calendarFocus,
	calendarPage,
	calendarQuery,
	hiddenClassesAt,
	importedEvents,
	invitationsOnly,
	laneSpotlight,
	leavingEvents,
	openRoutines,
	pendingInvitations,
	requestCreate,
	requestOrganise,
	routinesOn,
	selectedEventId,
	visibleEvents,
} from "../core/calendar-state.ts";
import type { CalendarAddress } from "../core/calendar-address.ts";
import { useCalendarAddress } from "../hooks/useCalendarAddress.ts";
import { repeatSentence } from "../core/event-recurrence.ts";
import { listRows } from "../core/event-series.ts";
import { entryOrganisable } from "../core/routine-actions.ts";
import { entryHoldsTime, groupByRoutine } from "../core/routine-view.ts";

/**
 * CalendarLane — the middle-nav lane for `/calendar`: what is coming, and when am I available.
 *
 * Built from the shared `@projective/ui/navigation` lane chrome, so it reads as the same control set
 * as the `/projects` feed, the `/messages` inbox and the `/wallet` rail rather than a fourth
 * lookalike. Both presentations — the expanded stack and the collapsed icon rail — are always in the
 * DOM and CSS reveals exactly one, keyed off the splitter's `data-mode`. A client width observer
 * would paint the wrong one for a frame on every load.
 *
 * The month navigator is not here: it is the middle-nav PANEL's (`CalendarPanel`), opened from the
 * header band, so the lane's height goes to the list it exists for.
 *
 * It fetches NOTHING. The body island owns the read and publishes it to {@link calendarPage}; this
 * lane renders whatever is in there, so the upcoming list and the grid can never be built from two
 * different responses.
 *
 * **When I am available is its own page** (`/calendar?view=availability`, Decision #376), reached
 * from the header band's Agenda ⇄ Availability switch and the rail's clock, so this lane is the
 * agenda's alone and its list gets the whole height.
 *
 * **The list scrolls on its own.** It is every entry the filters leave, in order and with a series
 * listed once ({@link listRows}), rather than a window
 * that followed the grid's focus — a list that re-anchored whenever the grid scrolled was the grid
 * scrolling it by proxy. The two views meet only on a pick: a row moves the grid onto its entry, and
 * an entry picked on the grid brings its row to the middle of the list ({@link selectEvent}).
 *
 * **A routine lists once** ({@link RoutineSection}, Decision #389). Its entries fold under it rather
 * than scattering through the list, which is the clutter a routine exists to end, and a row drags
 * between the two through `@projective/ui/dnd`, by pointer or by its grip from the keyboard.
 *
 * **Filter sits beside the search**, the `/projects` anatomy: the shared {@link LaneFilterPopover} over
 * {@link CalendarFilterFacets}, narrowing the grid and this list together.
 *
 * **Invitations sits under the search**, with the count of what is waiting on the reader, and narrows
 * the grid and this list together (`?filter=invitations`). It is drawn only while there is something
 * to narrow to, or the narrowing is on and has to be turned off.
 *
 * **New event is the lane footer's one create action**, beside a ghost Scheduling settings gear — the
 * anatomy of every lane footer (`/messages`, `/projects`; Decision #378). The footer band carries it
 * only below 767px, where the shell removes this lane, so it moves rather than doubles (Decisions
 * #60/#63). The view switch stays the footer band's.
 */
export interface CalendarLaneProps {
	/** The SSR page, so the lane paints its first frame with the same data the grid has. */
	initial: SchedulePage | null;
	/** The address asks for invitations alone, so the first byte is already narrowed. */
	invitations?: boolean;
	/** What the agenda's URL asks to be shown (Decision #413), so `?kind=` narrows the first byte. */
	address?: CalendarAddress;
}

export default function CalendarLane(props: CalendarLaneProps): JSX.Element {
	useCalendarAddress(props.address, props.initial?.timezone ?? null);
	const collapsed = useSignal(false);
	const laneRef = useRef<HTMLDivElement>(null);
	/** The row being dragged, for the ghost that follows the pointer. */
	const dragged = useSignal<CalendarEvent | null>(null);
	/** Off until the mount below has moved the address's narrowing into the shared signal. */
	const settled = useSignal(false);

	useEffect(() => {
		// The splitter owns the width; the lane mirrors its state only so the toggle glyph is right.
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
		if (props.invitations) invitationsOnly.value = true;
		settled.value = true;
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	// The body's published page wins the moment it exists; the SSR prop covers the first frame.
	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const all: CalendarEvent[] = [...(page?.events ?? []), ...importedEvents.value];
	const selected = selectedEventId.value;
	const routines = routinesOn(page);
	const now = page?.now ?? Date.now();
	const invitesOn = settled.value ? invitationsOnly.value : props.invitations === true;
	const invites = pendingInvitations(all, now).length;
	const leaving = leavingEvents.value;
	const listed = listRows(
		visibleEvents(all, invitesOn, hiddenClassesAt(props.address)),
		now,
		selected,
	);
	const { groups, loose } = groupByRoutine(listed, routines);

	/**
	 * Bring one row to the middle of whichever list holds it — that list's own scroll, never the page's.
	 */
	function centreRow(id: string, behavior: ScrollBehavior): void {
		const row = laneRef.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
		const list = row?.closest<HTMLElement>(".cal-rtn, .cal-lane__list");
		if (!list || !row) return;
		list.scrollTo({ top: row.offsetTop - (list.clientHeight - row.offsetHeight) / 2, behavior });
	}

	/** Land a dragged row: into a routine, which it then shows open, or out of the one it was in. */
	function dropEntry(drop: DragEndEvent): void {
		const event = dragged.peek();
		dragged.value = null;
		if (!event || drop.canceled || !drop.over) return;
		const routine = routines.find((r) => routineTarget(r.id) === drop.over) ?? null;
		if ((routine?.id ?? null) === (event.routineId ?? null)) return;
		if (!routine) {
			requestOrganise(event, { routineId: null });
			return;
		}
		if (!openRoutines.peek().includes(routine.id)) {
			openRoutines.value = [...openRoutines.peek(), routine.id];
		}
		requestOrganise(event, {
			routineId: routine.id,
			...(entryHoldsTime(event) ? {} : { availabilityBehavior: routine.behavior }),
		});
	}

	const rowFor = (e: CalendarEvent) => (
		<DraggableRow
			key={e.id}
			event={e}
			repeat={repeatSentence(e, all, tz)}
			tz={tz}
			selected={e.id === selected}
			flashing={e.id === flashing}
			all={all}
			leaving={leaving.includes(e.id)}
		/>
	);

	// The list opens on what is next rather than on the oldest entry the page carries.
	useEffect(() => {
		const now = page?.now ?? Date.now();
		const next = loose.find((e) => e.end > now);
		if (next) centreRow(next.id, "auto");
	}, []);

	// A pick on the grid: bring the row into view and let it glow once.
	const flashing = laneSpotlight.value;
	useEffect(() => {
		if (!flashing) return;
		// A task, so the row the pick just selected has rendered before it is measured.
		setTimeout(() => centreRow(flashing, scrollBehaviorFor()), 0);
	}, [flashing]);

	return (
		<div class="cal-lanewrap">
			{/* Collapsed presentation — revealed by CSS at the rail density. */}
			<div class="cal-rail">
				<div class="cal-rail__items" role="list">
					<Tooltip content="Today" placement="right" density="compact">
						<button
							type="button"
							class="cal-rail__item"
							aria-label="Go to today"
							onClick={() => (calendarFocus.value = Date.now())}
						>
							<Icon name="calendar" />
						</button>
					</Tooltip>
					<Tooltip content="Availability" placement="right" density="compact">
						<a
							class="cal-rail__item"
							href={calendarModeHref("availability")}
							aria-label="Availability"
						>
							<Icon name="clock" />
						</a>
					</Tooltip>
				</div>

				<div class="cal-rail__bottom">
					<Tooltip content="New event" placement="right" density="compact">
						<button
							type="button"
							class="cal-rail__item cal-rail__item--accent"
							aria-label="New event"
							onClick={requestCreate}
						>
							<Icon name="plus" />
						</button>
					</Tooltip>
					<LaneCollapseButton
						collapsed
						icon={<SidebarToggleIcon />}
						tooltipPlacement="right"
						onToggle={() => setCollapsed(false)}
					/>
				</div>
			</div>

			{/* Expanded presentation. */}
			<div class="cal-lane" ref={laneRef}>
				<LaneHead class="cal-lane__head">
					<AgendaFilters
						events={all}
						tz={tz}
						invitationsOn={invitesOn}
						invitations={invites}
						path="/calendar"
						address={props.address}
					/>
				</LaneHead>

				<DndContext
					onDragStart={(drag) => {
						dragged.value = all.find((e) => e.id === drag.active.id) ?? null;
					}}
					onDragEnd={dropEntry}
				>
					<RoutineSection
						groups={groups}
						selected={selected}
						narrowed={activeFilterCount(props.address) > 0 ||
							calendarQuery.value.trim() !== "" || invitesOn}
						renderRow={rowFor}
					/>
					<LooseEntries>
						<LaneList label="Events" class="cal-lane__list">
							{listed.length === 0
								? (
									<LaneEmpty
										title={invitesOn ? "No invitations" : "No events"}
										note={invitesOn
											? "Anything you are invited to waits here for your answer."
											: "Nothing matches the search and filters you have set."}
									/>
								)
								: loose.map(rowFor)}
						</LaneList>
					</LooseEntries>
					<DragOverlay class="cal-up-ghost">
						{dragged.value
							? <span class="cal-up__title">{agendaRowTitle(dragged.value)}</span>
							: null}
					</DragOverlay>
				</DndContext>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
					<LaneFooterActions>
						<LaneIconButton
							icon={<Icon name="settings" />}
							label="Scheduling settings"
							tooltipPlacement="top"
							onClick={() => openSettings("scheduling")}
						/>
						<LaneCreateButton
							label="New event"
							icon={<Icon name="plus" />}
							onClick={requestCreate}
						/>
					</LaneFooterActions>
				</LaneFooter>
			</div>
		</div>
	);
}

/**
 * A lane row: the shared {@link AgendaRow}, draggable into and out of a routine when its reader may
 * organise it — by its whole row, and from the keyboard by its grip, since the row's own button is
 * already the pick and one control cannot be both.
 */
function DraggableRow(props: Omit<AgendaRowProps, "drag">): JSX.Element {
	const organisable = entryOrganisable(props.event);
	const drag = useDraggable({
		id: props.event.id,
		data: { type: ENTRY_DRAG },
		disabled: !organisable,
		roleDescription: "movable entry",
	});
	return (
		<AgendaRow
			{...props}
			drag={organisable
				? {
					setNodeRef: drag.setNodeRef,
					onPointerDown: drag.listeners.onPointerDown,
					onGripKeyDown: drag.listeners.onKeyDown,
					dragging: drag.isDragging.value,
					roleDescription: drag.attributes["aria-roledescription"],
				}
				: undefined}
		/>
	);
}
