import { type CalendarEvent, eligibleVoterCount } from "@projective/types/scheduling";
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

/** The door each action writes through, or `null` where nothing keeps it yet. */
export const AUTHORING_DOOR: Readonly<Record<AuthoringAction, string | null>> = {
	create: "POST /api/scheduling/events",
	keyboardCreate: "POST /api/scheduling/events",
	move: "PATCH /api/scheduling/events",
	edit: "PATCH /api/scheduling/events",
	delete: "DELETE /api/scheduling/events",
	import: null,
};

const BY_HOST: Readonly<Record<CalendarHost, readonly AuthoringAction[]>> = {
	personal: ["create", "keyboardCreate", "move", "edit", "delete"],
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
 * The agenda's right-click rows for what the grid reported (Decision #380). An entry the viewer may
 * change offers Edit · Delete, each only where `can` has it; anyone else's opens read-only, as its
 * summary does. Empty time offers New event on that slot, and anywhere the grid cannot place (a
 * header, the timeline) a blank one at the focus — both only where `can` has `create`.
 */
export function agendaRows(
	target: CalendarContextTarget | null,
	tz: string,
	act: AgendaMenuActions,
	can: ReadonlySet<AuthoringAction>,
): MenuItem[] {
	const ev = target?.event as CalendarEvent | null | undefined;
	if (ev) {
		const rows: MenuItem[] = [];
		if (entryEditable(ev) && can.has("edit")) {
			rows.push({ key: "edit", label: "Edit event", command: () => act.edit(ev) });
		}
		if (entryEditable(ev) && can.has("delete")) {
			if (rows.length > 0) rows.push({ separator: true });
			rows.push({
				key: "delete",
				label: "Delete event",
				danger: true,
				command: () => act.remove(ev),
			});
		}
		return rows.length > 0
			? rows
			: [{ key: "open", label: "Open details", command: () => act.open(ev) }];
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
