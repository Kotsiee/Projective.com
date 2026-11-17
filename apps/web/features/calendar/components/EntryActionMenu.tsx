import type { JSX, RefObject } from "preact";
import { ActionMenu, type MenuItem } from "@projective/ui/navigation";
import type { CalendarContextTarget, CalendarRange } from "@projective/ui/calendar";
import type { CalendarEvent } from "@projective/types/scheduling";
import { agendaRows, authoringFor, type EntryMenuExtras } from "../core/calendar-authoring.ts";
import {
	calendarPage,
	openEventModal,
	requestDeleteConfirm,
	requestNewRoutine,
	requestOrganise,
	requestRecolour,
	routinesOn,
	selectEvent,
} from "../core/calendar-state.ts";
import { entryOrganisable } from "../core/routine-actions.ts";
import { joinRoutine, leaveRoutine } from "../core/routine-view.ts";
import { eventColourRow } from "./EventColorGrid.tsx";

/** What `/calendar` authors: its host's own entries, through the event door (C7 (a)). */
const AUTHORING = authoringFor("personal");

/** Props for {@link EntryActionMenu}. */
export interface EntryActionMenuProps {
	/** The region whose right-click opens the menu. */
	surface: RefObject<HTMLElement>;
	/** What the right-click landed on: an entry, a slot, or nothing the region could name. */
	target: CalendarContextTarget | null;
	tz: string;
	/** The view the menu belongs to, so its Open details is a pick from there. */
	from: "grid" | "list";
	/** New event on the slot under the pointer. */
	onCreateAt?: (range: CalendarRange) => void;
	/** New event at the focus, where the region could place none. */
	onCreateBlank?: () => void;
	/** The rows for a press on no entry, in place of New event (the lane's own). */
	background?: MenuItem[];
}

/** The rows an entry's menu adds beyond Edit · Delete, answered through the body's handshakes. */
function extras(): EntryMenuExtras {
	return {
		colour: (ev) => eventColourRow(ev, (accent) => requestRecolour(ev, accent)),
		routines: routinesOn(calendarPage.value),
		organisable: entryOrganisable,
		organise: (ev, routine) =>
			requestOrganise(ev, routine ? joinRoutine(ev, routine) : leaveRoutine(ev)),
		newRoutine: (ev: CalendarEvent) =>
			requestNewRoutine((routine) => requestOrganise(ev, joinRoutine(ev, routine))),
	};
}

/**
 * EntryActionMenu — the ONE right-click menu an agenda entry has (Decisions #380, #441), on the grid
 * and in the lane alike: Edit event · its colour · Routine · Delete event for an entry the reader
 * hosts, Open details for anyone else's. Every row answers through `calendar-state`, so the lane, a
 * separate hydration root, reaches the same writes and the same delete confirmation as the grid.
 */
export function EntryActionMenu(props: EntryActionMenuProps): JSX.Element {
	const { target, tz, from } = props;
	const model = target?.event || !props.background
		? agendaRows(target, tz, {
			create: (range) => props.onCreateAt?.(range),
			createBlank: () => props.onCreateBlank?.(),
			open: (ev) => selectEvent(ev, from),
			edit: (ev) => openEventModal(ev.id),
			remove: requestDeleteConfirm,
		}, AUTHORING, extras())
		: props.background;
	return (
		<ActionMenu
			model={model}
			surface={props.surface}
			aria-label={target?.event ? "Event actions" : "Calendar actions"}
		/>
	);
}
