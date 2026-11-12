import { assert, assertEquals } from "@std/assert";
import {
	type CalendarEvent,
	type EventAttendee,
	EventAttendeeSchema,
} from "@projective/types/scheduling";
import type { CalendarContextTarget } from "@ui/calendar/core/types.ts";
import {
	type AgendaMenuActions,
	agendaRows,
	AUTHORING_DOOR,
	type AuthoringAction,
	authoringFor,
	type CalendarHost,
	entryEditable,
	timesMovable,
} from "./calendar-authoring.ts";

const HOSTS: readonly CalendarHost[] = ["personal", "project", "schedule"];
const START = Date.parse("2026-11-16T10:00:00.000Z");

function entry(over: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		id: "0b6f1f7e-4c1d-4a8e-9c35-0d6c1b7f2a10",
		title: "Studio time",
		kind: "sync",
		start: START,
		end: START + 3_600_000,
		viewerIsHost: true,
		...over,
	};
}

function seat(role: EventAttendee["role"], isGuest = false): EventAttendee {
	return EventAttendeeSchema.parse({
		id: `seat-${role}-${isGuest}`,
		name: "Ines Duarte",
		avatar: null,
		handle: "inesduarte",
		role,
		response: "pending",
		respondedAt: null,
		note: null,
		isGuest,
		model: "free",
		unitPrice: null,
		paidSeats: 0,
		occurrenceEarnings: null,
		seriesEarnings: null,
	});
}

/**
 * The rows a target gets, as `key → the handler its press reached`. A row that renders without a
 * handler fails here: that is the gate-11 check (a control that renders must do something).
 */
function reached(
	target: CalendarContextTarget | null,
	can: ReadonlySet<AuthoringAction>,
): Record<string, string> {
	const calls: string[] = [];
	const act: AgendaMenuActions = {
		create: () => calls.push("create"),
		createBlank: () => calls.push("createBlank"),
		open: () => calls.push("open"),
		edit: () => calls.push("edit"),
		remove: () => calls.push("remove"),
	};
	const out: Record<string, string> = {};
	for (const row of agendaRows(target, "Europe/London", act, can)) {
		if (row.separator) continue;
		assert(row.key && row.command, `row "${row.label}" renders without a handler`);
		calls.length = 0;
		row.command({ originalEvent: new Event("click"), item: row });
		out[row.key] = calls.join("+");
	}
	return out;
}

// #region Each body
Deno.test("every authoring control a body renders has a door that keeps it", () => {
	for (const host of HOSTS) {
		for (const action of authoringFor(host)) {
			assert(AUTHORING_DOOR[action], `${host} renders ${action}, which writes nothing`);
		}
	}
});

Deno.test("/calendar authors its host's own entries through the event door", () => {
	assertEquals([...authoringFor("personal")].sort(), [
		"create",
		"delete",
		"edit",
		"keyboardCreate",
		"move",
	]);
});

Deno.test("the project calendars and a public schedule author nothing (C7 (a), S-25, S-33)", () => {
	assertEquals([...authoringFor("project")], []);
	assertEquals([...authoringFor("schedule")], []);
});

Deno.test(".ics import is on no calendar until a door keeps what it reads", () => {
	assertEquals(AUTHORING_DOOR.import, null);
	for (const host of HOSTS) assert(!authoringFor(host).has("import"), host);
});
// #endregion

// #region One entry
Deno.test("only the host's own plain entry is editable", () => {
	assert(entryEditable(entry()));
	assert(!entryEditable(entry({ viewerIsHost: false })), "a seat on someone's entry");
	assert(!entryEditable(entry({ viewerIsHost: undefined })), "an entry nobody said is theirs");
	assert(!entryEditable(entry({ projectId: "prj-a" })), "an engagement's, moved by negotiation");
	assert(!entryEditable(entry({ callId: "call-1" })), "a discovery call, moved by its doors");
	assert(!entryEditable(entry({ connected: true })), "a connected calendar's, which the sync owns");
});

Deno.test("a time moves at the host's say only until somebody who can vote is on it", () => {
	assert(timesMovable(entry()));
	assert(timesMovable(entry({ roster: [seat("host"), seat("participant", true)] })), "guests");
	assert(!timesMovable(entry({ roster: [seat("host"), seat("participant")] })), "a voter");
	assert(!timesMovable(entry({ projectId: "prj-a" })));
});
// #endregion

// #region The right-click rows
Deno.test("each right-click row reaches its own handler", () => {
	const can = authoringFor("personal");
	assertEquals(reached({ event: entry(), range: null }, can), { edit: "edit", delete: "remove" });
	assertEquals(reached({ event: entry({ projectId: "prj-a" }), range: null }, can), {
		open: "open",
	});
	assertEquals(reached({ event: entry({ connected: true }), range: null }, can), { open: "open" });
	assertEquals(
		reached({ event: null, range: { start: START, end: START + 1_800_000 } }, can),
		{ new: "create" },
	);
	assertEquals(reached({ event: null, range: null }, can), { new: "createBlank" });
	assertEquals(reached(null, can), { new: "createBlank" });
});

Deno.test("a body that authors nothing offers no New, Edit or Delete row", () => {
	const none = authoringFor("project");
	assertEquals(reached({ event: entry(), range: null }, none), { open: "open" });
	assertEquals(reached({ event: null, range: null }, none), {});
});
// #endregion
