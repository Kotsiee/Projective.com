import { assertEquals } from "@std/assert";
import {
	engagementArchetype,
	engagementHomeHref,
	engagementTypeLabel,
	isStagedArchetype,
} from "./archetype.ts";

Deno.test("the archetype reads the two stored axes, never the engagement's kind", () => {
	assertEquals(engagementArchetype("pipeline", "standard"), "pipeline");
	assertEquals(engagementArchetype("one_off", "one_off"), "one_off");
	assertEquals(engagementArchetype("one_off", "single_task"), "task");
	assertEquals(engagementArchetype("one_off", "single_stage"), "task");
	assertEquals(engagementArchetype("session", "standard"), "session");
});

Deno.test("an instantiated pipeline is a Pipeline service, not a Calendar service", () => {
	assertEquals(
		engagementTypeLabel(engagementArchetype("pipeline", "standard"), "service"),
		"Pipeline service",
	);
	assertEquals(engagementTypeLabel("one_off", "service"), "One-off service");
	assertEquals(engagementTypeLabel("session", "service"), "Session service");
	assertEquals(engagementTypeLabel("task", "project"), "Task project");
});

Deno.test("each archetype opens on its own home view", () => {
	assertEquals(engagementHomeHref("prj-abc", "pipeline"), "/projects/prj-abc/board");
	assertEquals(engagementHomeHref("prj-abc", "one_off"), "/projects/prj-abc/timeline");
	assertEquals(
		engagementHomeHref("prj-abc", "one_off", { setupIncomplete: true }),
		"/projects/prj-abc/details",
	);
	assertEquals(engagementHomeHref("prj-abc", "session"), "/projects/prj-abc/calendar");
	assertEquals(engagementHomeHref("prj-abc", "task"), "/projects/prj-abc");
});

Deno.test("only pipelines and milestone one-offs run on stage channels", () => {
	assertEquals(isStagedArchetype("pipeline"), true);
	assertEquals(isStagedArchetype("one_off"), true);
	assertEquals(isStagedArchetype("task"), false);
	assertEquals(isStagedArchetype("session"), false);
});
