import { assert, assertEquals, assertFalse } from "@std/assert";
import type { CalendarEvent, Routine } from "@projective/types/scheduling";
import {
	entryHoldsTime,
	groupByRoutine,
	organisedPatch,
	routineMeta,
	sessionServicesHref,
} from "./routine-view.ts";

const routine = (id: string, over: Partial<Routine> = {}): Routine => ({
	id,
	scheduleId: "s",
	name: "Gym",
	slug: "rtn-2222222222",
	colorToken: "--primary",
	isActive: true,
	behavior: "passive",
	recurrenceRule: null,
	metadata: {},
	createdAt: "",
	updatedAt: "",
	...over,
});

const entry = (id: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id,
	title: id,
	kind: "sync",
	start: 0,
	end: 1,
	...over,
});

Deno.test("groups: a routine holds its entries, in the order the routines were made", () => {
	const a = entry("a", { routineId: "r2" });
	const b = entry("b", { routineId: "r1" });
	const c = entry("c");
	const { groups, loose } = groupByRoutine([a, b, c], [routine("r1"), routine("r2")]);
	assertEquals(groups.map((g) => [g.routine.id, g.members.map((e) => e.id)]), [
		["r1", ["b"]],
		["r2", ["a"]],
	]);
	assertEquals(loose.map((e) => e.id), ["c"]);
});

Deno.test("groups: an entry of an archived routine is simply an entry again", () => {
	const orphan = entry("a", { routineId: "archived" });
	const { groups, loose } = groupByRoutine([orphan], [routine("r1")]);
	assertEquals(groups[0].members, []);
	assertEquals(loose, [orphan]);
});

Deno.test("a routine's line says how much it holds and what it does", () => {
	assertEquals(routineMeta(routine("r"), 1), "1 entry · Passive");
	assertEquals(routineMeta(routine("r", { behavior: "disruptive" }), 3), "3 entries · Disruptive");
	assertEquals(routineMeta(routine("r"), 0), "0 entries · Passive");
});

Deno.test("a commitment holds its time, as fn_event_holds_time says", () => {
	assert(entryHoldsTime(entry("a", { kind: "session" })));
	assert(entryHoldsTime(entry("a", { kind: "booking" })));
	assert(entryHoldsTime(entry("a", { projectId: "prj-2222222222" })));
	assert(entryHoldsTime(entry("a", {
		roster: [{ id: "1" }] as unknown as CalendarEvent["roster"],
	})));
	assertFalse(entryHoldsTime(entry("a", { kind: "busy", connected: true })));
	assertFalse(entryHoldsTime(entry("a", { roster: [] })));
});

Deno.test("a working copy spells leaving a routine as no routine, and leaves what was not said", () => {
	assertEquals(organisedPatch({ routineId: null }), { routineId: undefined });
	assertEquals(organisedPatch({ routineId: "r" }), { routineId: "r" });
	const behaviourOnly = organisedPatch({ availabilityBehavior: "passive" });
	assertEquals(behaviourOnly, { availabilityBehavior: "passive" });
	// Spread over the entry, an absent key must not clear the routine it is in.
	assertFalse("routineId" in behaviourOnly);
});

Deno.test("a passive routine points at Session Services, on its own words", () => {
	const url = new URL(sessionServicesHref(routine("r", { name: "Spanish & Co" })), "http://x");
	assertEquals(url.pathname, "/explore");
	assertEquals(url.searchParams.get("q"), "Spanish & Co");
	assertEquals(url.searchParams.get("category"), "services");
	assertEquals(url.searchParams.get("model"), "session");
});
