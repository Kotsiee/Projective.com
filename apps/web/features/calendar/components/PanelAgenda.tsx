import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { LaneEmpty, LaneList } from "@projective/ui/navigation";
import type { CalendarEvent, SchedulePage } from "@projective/types/scheduling";
import { AgendaFilters } from "./AgendaFilters.tsx";
import { AgendaRow } from "./AgendaRow.tsx";
import {
	importedEvents,
	laneSpotlight,
	leavingEvents,
	pendingInvitations,
	selectedEventId,
	visibleEvents,
} from "../core/calendar-state.ts";
import { repeatSentence } from "../core/event-recurrence.ts";
import { listRows } from "../core/event-series.ts";

/** Props for {@link PanelAgenda}. */
export interface PanelAgendaProps {
	page: SchedulePage | null;
	/** Whether Invitations Only is on, settled from the address for the first byte. */
	invitationsOn: boolean;
	/** The page the Invitations row narrows. */
	path: string;
}

/**
 * PanelAgenda — the right panel's Events tab on a team's or business's calendar: what the `/calendar`
 * lane holds — the search, the filter, Event type, Invitations and every entry they leave — for a
 * console whose lane is its management rail. The rows are the lane's own ({@link AgendaRow}): a pick
 * moves the grid onto the entry and opens it in this panel, whose Back returns here. The list scrolls
 * on its own and opens on what is next.
 */
export function PanelAgenda(props: PanelAgendaProps): JSX.Element {
	const listRef = useRef<HTMLDivElement>(null);
	const page = props.page;
	const tz = page?.timezone ?? "UTC";
	const all: CalendarEvent[] = [...(page?.events ?? []), ...importedEvents.value];
	const now = page?.now ?? Date.now();
	const selected = selectedEventId.value;
	const flashing = laneSpotlight.value;
	const leaving = leavingEvents.value;
	const listed = listRows(visibleEvents(all, props.invitationsOn), now, selected);

	useEffect(() => {
		const list = listRef.current;
		const next = listed.find((e) => e.end > now);
		const row = next
			? list?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(next.id)}"]`)
			: null;
		if (!list || !row) return;
		list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
	}, []);

	return (
		<div class="cal-panel__agenda">
			<div class="cal-panel__agenda-head">
				<AgendaFilters
					events={all}
					tz={tz}
					invitationsOn={props.invitationsOn}
					invitations={pendingInvitations(all, now).length}
					path={props.path}
					searchLabel="Search this calendar"
				/>
			</div>
			<div class="cal-panel__list" ref={listRef}>
				<LaneList label="Events">
					{listed.length === 0
						? (
							<LaneEmpty
								title={props.invitationsOn ? "No invitations" : "No events"}
								note={props.invitationsOn
									? "Anything you are invited to waits here for your answer."
									: "Nothing matches the search and filters you have set."}
							/>
						)
						: listed.map((e) => (
							<AgendaRow
								key={e.id}
								event={e}
								repeat={repeatSentence(e, all, tz)}
								tz={tz}
								selected={e.id === selected}
								flashing={e.id === flashing}
								all={all}
								leaving={leaving.includes(e.id)}
							/>
						))}
				</LaneList>
			</div>
		</div>
	);
}
