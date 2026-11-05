import { assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import { deepLinkedEvent, withEventParam } from "./event-deep-link.ts";

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

Deno.test("picking an entry names it, replacing whichever was named before", () => {
	assertEquals(withEventParam("/calendar", "", "a"), "/calendar?event=a");
	assertEquals(withEventParam("/calendar", "?event=a&x=1", "b"), "/calendar?event=b&x=1");
});
