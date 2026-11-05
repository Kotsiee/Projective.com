import { assertEquals } from "@std/assert";
import type { CalendarEvent, Routine } from "@projective/types/scheduling";
import {
	deepLinkedEvent,
	deepLinkedRoutine,
	invitationsFiltered,
	withEventParam,
	withInvitationsFilter,
	withRoutineParam,
} from "./event-deep-link.ts";

const EVENT: CalendarEvent = {
	id: "8b0f6a52-2f1e-4f7e-9d55-0c6d1a7e0001",
	title: "Portrait session",
	kind: "session",
	start: 1_760_000_000_000,
	end: 1_760_003_600_000,
};

Deno.test("?event= opens the occurrence the agenda holds, and nothing it does not", () => {
	assertEquals(deepLinkedEvent(`?event=${EVENT.id}`, [EVENT])?.id, EVENT.id);
	assertEquals(deepLinkedEvent("?event=someone-else", [EVENT]), null);
	assertEquals(deepLinkedEvent("", [EVENT]), null);
});

Deno.test("closing the event drops only its parameter", () => {
	assertEquals(withEventParam("/calendar", `?event=${EVENT.id}`, null), "/calendar");
	assertEquals(
		withEventParam("/calendar", `?view=week&event=${EVENT.id}`, null),
		"/calendar?view=week",
	);
});

Deno.test("?routine= names a routine of the reader's by its slug, and no one else's", () => {
	const routine = { id: "r", slug: "rtn-2222222222" } as Routine;
	assertEquals(deepLinkedRoutine(`?routine=${routine.slug}`, [routine]), routine);
	assertEquals(deepLinkedRoutine("?routine=rtn-3333333333", [routine]), null);
	assertEquals(deepLinkedRoutine("", [routine]), null);
});

Deno.test("the inspector holds one thing, so naming either drops both", () => {
	assertEquals(
		withRoutineParam("/calendar", "?event=a&x=1", "rtn-2222222222"),
		"/calendar?x=1&routine=rtn-2222222222",
	);
	assertEquals(withEventParam("/calendar", "?routine=rtn-2222222222", "a"), "/calendar?event=a");
	assertEquals(withRoutineParam("/calendar", "?routine=rtn-2222222222", null), "/calendar");
});

Deno.test("the invitations narrowing is an address of its own, beside whatever else it names", () => {
	assertEquals(invitationsFiltered("?filter=invitations&event=a"), true);
	assertEquals(invitationsFiltered("?filter=other"), false);
	assertEquals(invitationsFiltered(""), false);
	assertEquals(
		withInvitationsFilter("/calendar", "?event=a", true),
		"/calendar?event=a&filter=invitations",
	);
	assertEquals(
		withInvitationsFilter("/calendar", "?filter=invitations&event=a", false),
		"/calendar?event=a",
	);
	assertEquals(withInvitationsFilter("/calendar", "?filter=invitations", false), "/calendar");
	// Picking an entry in that view keeps the view.
	assertEquals(
		withEventParam("/calendar", "?filter=invitations", "a"),
		"/calendar?filter=invitations&event=a",
	);
});

Deno.test("picking an entry names it, replacing whichever was named before", () => {
	assertEquals(withEventParam("/calendar", "", "a"), "/calendar?event=a");
	assertEquals(withEventParam("/calendar", "?event=a&x=1", "b"), "/calendar?event=b&x=1");
});
