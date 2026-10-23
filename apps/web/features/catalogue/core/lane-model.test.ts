import { assertEquals } from "@std/assert";
import { CONSOLE_DEFAULTS, type ConsoleUrlState } from "@projective/types/catalogue";
import {
	activeFilterCount,
	defaultLaneMemory,
	laneFilterOf,
	OWN_SECTION,
	parseLaneMemory,
	resetFilterPatch,
	serializeLaneMemory,
	teamSection,
	toggleCategory,
	toggleHighlight,
	toggleModel,
	toggleStatus,
	visibleTeams,
} from "./lane-model.ts";

Deno.test("the resting console narrows nothing", () => {
	assertEquals(activeFilterCount({ ...CONSOLE_DEFAULTS }), 0);
});

Deno.test("a status set counts once; each other facet value and a moved sort once each", () => {
	const state: ConsoleUrlState = {
		...CONSOLE_DEFAULTS,
		status: ["draft"],
		highlights: ["promoted", "attention"],
		model: ["Session"],
		create: ["run"],
		sort: "title",
		dir: "asc",
	};
	assertEquals(activeFilterCount(state), 6);
	assertEquals(activeFilterCount({ ...CONSOLE_DEFAULTS, dir: "asc" }), 1);
});

Deno.test("the last status cannot be released", () => {
	assertEquals(toggleStatus(["draft"], "draft"), ["draft"]);
	assertEquals(toggleStatus(["draft", "paused"], "draft"), ["paused"]);
	assertEquals(toggleStatus(["draft"], "archived"), ["draft", "archived"]);
});

Deno.test("facet toggles keep the canonical order", () => {
	assertEquals(toggleHighlight(["best-selling"], "attention"), ["attention", "best-selling"]);
	assertEquals(toggleHighlight(["attention"], "attention"), []);
	assertEquals(toggleModel(["Session"], "Pipeline"), ["Pipeline", "Session"]);
	assertEquals(toggleCategory(["test"], "create"), ["create", "test"]);
});

Deno.test("reset returns every facet and the sort to rest", () => {
	const reset = { ...CONSOLE_DEFAULTS, ...resetFilterPatch() };
	assertEquals(activeFilterCount(reset), 0);
});

Deno.test("no cookie is the default memory", () => {
	assertEquals(parseLaneMemory(undefined), defaultLaneMemory());
	assertEquals(parseLaneMemory(""), defaultLaneMemory());
	assertEquals(defaultLaneMemory().open, [OWN_SECTION]);
});

Deno.test("the memory round-trips through its cookie value", () => {
	const memory = {
		filter: laneFilterOf({
			...CONSOLE_DEFAULTS,
			search: "logo",
			status: ["published", "archived"],
			highlights: ["promoted"],
			model: ["Pipeline"],
			create: ["educate"],
			sort: "title",
			dir: "desc",
			type: "service",
		}),
		teams: ["studiofern"],
		open: [teamSection("studiofern")],
	};
	assertEquals(parseLaneMemory(serializeLaneMemory(memory)), memory);
});

Deno.test("an explicitly empty open set stays empty", () => {
	const memory = { ...defaultLaneMemory(), open: [] };
	assertEquals(parseLaneMemory(serializeLaneMemory(memory)).open, []);
});

Deno.test("the memory keeps only the filter, never the view or the create seed", () => {
	const filter = laneFilterOf({
		...CONSOLE_DEFAULTS,
		view: "analytics",
		createOpen: true,
		createKind: "product",
		period: "90d",
		team: "studiofern",
	});
	assertEquals(filter, { ...CONSOLE_DEFAULTS });
});

Deno.test("a tampered cookie drops what it cannot read", () => {
	const memory = parseLaneMemory("f=status%3Dnope&teams=Bad%20Handle,ok-team&open=own,team:%20,elsewhere");
	assertEquals(memory.filter.status, CONSOLE_DEFAULTS.status);
	assertEquals(memory.teams, ["ok-team"]);
	assertEquals(memory.open, [OWN_SECTION]);
});

Deno.test("no team choice shows every team", () => {
	const teams = [{ handle: "a-team" }, { handle: "b-team" }];
	assertEquals(visibleTeams(teams, []), teams);
	assertEquals(visibleTeams(teams, ["b-team"]), [{ handle: "b-team" }]);
});
