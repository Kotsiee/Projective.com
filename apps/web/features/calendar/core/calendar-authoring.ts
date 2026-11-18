import {
	type CalendarEvent,
	eligibleVoterCount,
	type EntryClass,
	type Routine,
} from "@projective/types/scheduling";
import type { CalendarContextTarget, CalendarRange } from "@ui/calendar/core/types.ts";
import type { MenuItem } from "@ui/types/mod.ts";

/**
 * calendar-authoring — what a calendar body may author, decided in one place (Decision #343 ruling
 * C7 (a)): an authoring control renders only where a write door keeps what it does. It is never drawn
 * disabled with a tooltip, nor labelled "preview only" (gate 11).
 *
 * The one door is `/api/scheduling/events` (Decision #328 (a)), and it keeps the caller's OWN entries
 * on `/calendar` and nothing else: an engagement's events move only through their negotiation, a
 * discovery call only through its own doors, and an entry mirrored in from a connected calendar is
 * the provider's (`hostRefusal`). So `/calendar` authors its host's own entries, and the project
 * calendars and a person's public schedule author nothing. RSVP, the reschedule negotiation and the
 * discovery-call moves are answers, not authoring, and stay on every calendar that shows them.
 *
 * An `.ics` import IS authoring again (Decision #442, reversing #440's view-only import): `/calendar`
 * lays a file down as its host's own entries through the same create door, so every imported entry is
 * the host's, edits, moves and deletes like any other, and only `/calendar` offers Import or the grid's
 * file drop.
 *
 * Pure: no DOM, no signals.
 */

// #region The bodies
/** The calendar bodies: `/calendar`, an engagement's calendar, and `/[handle]/availability`. */
export type CalendarHost = "personal" | "project" | "schedule";

/** Every authoring control a calendar body can render. */
export type AuthoringAction =
	| "create"
	| "keyboardCreate"
	| "move"
	| "edit"
	| "delete"
	| "import";

/** The door each action writes through. */
export const AUTHORING_DOOR: Readonly<Record<AuthoringAction, string>> = {
	create: "POST /api/scheduling/events",
	keyboardCreate: "POST /api/scheduling/events",
	move: "PATCH /api/scheduling/events",
	edit: "PATCH /api/scheduling/events",
	delete: "DELETE /api/scheduling/events",
	import: "POST /api/scheduling/events",
};

const BY_HOST: Readonly<Record<CalendarHost, readonly AuthoringAction[]>> = {
	personal: ["create", "keyboardCreate", "move", "edit", "delete", "import"],
	project: [],
	schedule: [],
};

/** The authoring controls a body renders. Each one has a door ({@link AUTHORING_DOOR}). */
export function authoringFor(host: CalendarHost): ReadonlySet<AuthoringAction> {
	return new Set(BY_HOST[host]);
}
// #endregion

// #region One entry
/**
 * Whether the viewer may change this entry from a calendar: theirs, and not a discovery call, which
 * changes only through its own doors, nor an engagement's event, which moves only through its
 * negotiation, nor one mirrored from a connected calendar, which the next sync would overwrite. Each
 * is a certain refusal at the door (`hostRefusal`), so none is offered a Save.
 */
export function entryEditable(event: CalendarEvent): boolean {
	return event.viewerIsHost === true && !event.callId && !event.projectId &&
		event.connected !== true;
}

/**
 * Whether its TIME moves at the host's say: once somebody who can vote is on an entry it moves only
 * by agreement (`trg_guard_rostered_event`). A guest cannot vote, so a host with only guests moves it,
 * and they are told.
 */
export function timesMovable(event: CalendarEvent): boolean {
	return entryEditable(event) && eligibleVoterCount(event.roster ?? []) === 0;
}
// #endregion

// #region The agenda's right-click rows
/** What the agenda's right-click rows do; the body supplies them. */
export interface AgendaMenuActions {
	create: (range: CalendarRange) => void;
	createBlank: () => void;
	open: (event: CalendarEvent) => void;
	edit: (event: CalendarEvent) => void;
	remove: (event: CalendarEvent) => void;
}

/**
 * What else an entry's menu offers where the surface has it (Decision #441): its colour, drawn by the
 * caller as a menu row, and the routine it is in.
 */
export interface EntryMenuExtras {
	/** The colour grid as a menu row, for an entry the viewer may edit. */
	colour?: (event: CalendarEvent) => MenuItem;
	/** The live routines, offered to an entry the viewer may organise. */
	routines?: readonly Routine[];
	/** Whether the viewer may organise this entry (`entryOrganisable`). */
	organisable?: (event: CalendarEvent) => boolean;
	/** Move it into a routine, or out of the one it is in (`null`). */
	organise?: (event: CalendarEvent, routine: Routine | null) => void;
	/** Make a routine and move it in. */
	newRoutine?: (event: CalendarEvent) => void;
}

/** The Routine submenu: every live routine, No routine, and New routine; where it is now is inert. */
function routineRow(ev: CalendarEvent, extras: EntryMenuExtras): MenuItem | null {
	const { routines, organise } = extras;
	if (!routines || !organise || !extras.organisable?.(ev)) return null;
	const current = routines.find((r) => r.id === ev.routineId)?.id ?? null;
	const items: MenuItem[] = [
		{
			key: "routine:none",
			label: "No routine",
			disabled: current === null,
			disabledReason: current === null ? "It is in no routine." : undefined,
			command: () => organise(ev, null),
		},
		...routines.map((r): MenuItem => ({
			key: `routine:${r.id}`,
			label: r.name,
			disabled: r.id === current,
			disabledReason: r.id === current ? "It is already in this routine." : undefined,
			command: () => organise(ev, r),
		})),
	];
	if (extras.newRoutine) {
		const make = extras.newRoutine;
		items.push({ separator: true }, {
			key: "routine:new",
			label: "New routine…",
			command: () => make(ev),
		});
	}
	return { key: "routine", label: "Routine", items };
}

/**
 * The agenda's right-click rows for what the grid or the lane reported (Decisions #380, #441). An entry
 * the viewer may change offers Edit · its colour · Delete, each only where `can` has it; anyone else's
 * opens read-only, as its summary does. An entry the viewer may organise offers its Routine too. Empty
 * time offers New event on that slot, and anywhere the grid cannot place (a header, the timeline) a
 * blank one at the focus — both only where `can` has `create`.
 */
export function agendaRows(
	target: CalendarContextTarget | null,
	tz: string,
	act: AgendaMenuActions,
	can: ReadonlySet<AuthoringAction>,
	extras: EntryMenuExtras = {},
): MenuItem[] {
	const ev = target?.event as CalendarEvent | null | undefined;
	if (ev) {
		const rows: MenuItem[] = [];
		const editable = entryEditable(ev) && can.has("edit");
		if (editable) {
			rows.push({ key: "edit", label: "Edit event", command: () => act.edit(ev) });
		} else {
			rows.push({ key: "open", label: "Open details", command: () => act.open(ev) });
		}
		if (editable && extras.colour) rows.push(extras.colour(ev));
		const routine = routineRow(ev, extras);
		if (routine) rows.push(routine);
		if (entryEditable(ev) && can.has("delete")) {
			rows.push({ separator: true }, {
				key: "delete",
				label: "Delete event",
				danger: true,
				command: () => act.remove(ev),
			});
		}
		return rows;
	}
	if (!can.has("create")) return [];
	const range = target?.range;
	if (!range) return [{ key: "new", label: "New event", command: act.createBlank }];
	const when = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		weekday: "short",
		day: "numeric",
		month: "short",
		...(range.allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
	}).format(range.start);
	return [{ key: "new", label: "New event", hint: when, command: () => act.create(range) }];
}
// #endregion

// #region The lane's right-click rows
/** What the lane's own right-click rows do; the lane supplies them. */
export interface LaneMenuActions {
	create: (entry: EntryClass) => void;
	newRoutine: () => void;
	/** Gather entries into `routine`; `null` asks which, or with no routine yet, makes one first. */
	addToRoutine: (routine: Routine | null) => void;
}

/**
 * The rows a right-click on the lane itself gets, rather than on an entry in it (Decision #441): New
 * event · New reminder where `can` has `create`, then New routine and a way to gather existing entries
 * into one. On a routine's own row the gathering names that routine.
 */
export function laneRows(
	routine: Routine | null,
	routines: readonly Routine[],
	act: LaneMenuActions,
	can: ReadonlySet<AuthoringAction>,
): MenuItem[] {
	const rows: MenuItem[] = [];
	if (can.has("create")) {
		rows.push(
			{ key: "new-event", label: "New event", command: () => act.create("event") },
			{ key: "new-reminder", label: "New reminder", command: () => act.create("reminder") },
			{ separator: true },
		);
	}
	rows.push(
		{ key: "new-routine", label: "New routine", command: act.newRoutine },
		{
			key: "add-to-routine",
			label: routine
				? `Add entries to ${routine.name}…`
				: routines.length > 0
				? "Add entries to a routine…"
				: "Add entries to a new routine…",
			command: () => act.addToRoutine(routine),
		},
	);
	return rows;
}
// #endregion
