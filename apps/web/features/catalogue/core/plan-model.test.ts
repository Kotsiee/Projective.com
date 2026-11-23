import { assertEquals } from "@std/assert";
import { normaliseSessionPlan } from "@projective/types/catalogue";
import { SESSION_PLAN_MAX } from "@projective/types/explore";
import { weeklyTemplatesProblem } from "@projective/types/projects";
import {
	canAddSession,
	hasPlan,
	planRows,
	planSummary,
	templateRows,
	type TimedOffer,
	withSessionAdded,
	withSessionEntry,
	withSessionMoved,
	withSessionRemoved,
	withTemplateMoved,
	withTemplateRemoved,
	withVariableLengths,
} from "./plan-model.ts";

const OFFER: TimedOffer = {
	archetype: "session",
	minutes: 60,
	count: 3,
	meetingProvider: null,
	plan: [{ title: "Discovery", description: "" }, { title: "", description: "Build it." }],
	rolling: false,
};

Deno.test("rows follow the count, blank where nothing is written", () => {
	assertEquals(planRows(OFFER).map((r) => r.title || r.description || "·"), [
		"Discovery",
		"Build it.",
		"·",
	]);
});

Deno.test("adding a sitting appends a blank row up to the cap", () => {
	const added = withSessionAdded(OFFER);
	assertEquals([added.count, added.plan.length], [4, 3]);
	const full = { ...OFFER, count: SESSION_PLAN_MAX };
	assertEquals(canAddSession(full), false);
	assertEquals(withSessionAdded(full), full);
});

Deno.test("removing a sitting moves the later ones up and keeps the last", () => {
	const removed = withSessionRemoved(OFFER, 0);
	assertEquals(removed.count, 2);
	assertEquals(removed.plan[0].description, "Build it.");
	const one = { ...OFFER, count: 1 };
	assertEquals(withSessionRemoved(one, 0), one);
});

Deno.test("a moved sitting carries its title and description, never a neighbour's", () => {
	const moved = withSessionMoved(OFFER, 0, 2);
	assertEquals(moved.plan.map((r) => r.title || r.description), ["Build it.", "", "Discovery"]);
	assertEquals(normaliseSessionPlan(moved).length, 3);
	assertEquals(withSessionMoved(OFFER, 0, 5), OFFER);
});

Deno.test("writing a sitting changes that row alone", () => {
	const written = withSessionEntry(OFFER, 2, { title: "Review" });
	assertEquals(written.plan.map((r) => r.title), ["Discovery", "", "Review"]);
});

Deno.test("the summary counts sittings and how many are planned", () => {
	assertEquals(planSummary(OFFER), ["3 sessions", "2 planned"]);
	assertEquals(planSummary({ count: 1, plan: [] }), ["1 session", "Not planned yet"]);
	assertEquals(planSummary({ count: 1, plan: [{ title: "Intro", description: "" }] }), [
		"1 session",
		"Each one planned",
	]);
});

Deno.test("an ongoing one-to-one listing has no plan; a group session always does", () => {
	assertEquals(hasPlan(OFFER), true);
	assertEquals(hasPlan({ ...OFFER, rolling: true }), false);
	assertEquals(
		hasPlan({
			archetype: "cohort",
			minutes: 60,
			count: 4,
			meetingProvider: null,
			plan: [],
			maxSeatsPerCohort: 10,
			continuousEnrollment: false,
		}),
		true,
	);
});

Deno.test("templateRows: a sitting without a template gets the day after the one before, at its time", () => {
	assertEquals(templateRows([], 2), [{ weekday: 1, startMinute: 1080 }, {
		weekday: 2,
		startMinute: 1080,
	}]);
	assertEquals(templateRows([{ weekday: 7, startMinute: 370 }], 2), [
		{ weekday: 7, startMinute: 370 },
		{ weekday: 1, startMinute: 370 },
	]);
	assertEquals(templateRows([{ weekday: 4, startMinute: 0 }, { weekday: 1, startMinute: 0 }], 1), [
		{ weekday: 4, startMinute: 0 },
	]);
});

Deno.test("withTemplateMoved / withTemplateRemoved: a time moves and leaves with its session", () => {
	const week = [{ weekday: 4, startMinute: 370 }, { weekday: 1, startMinute: 370 }, {
		weekday: 3,
		startMinute: 370,
	}];
	assertEquals(withTemplateMoved(week, 3, 0, 2).map((t) => t.weekday), [1, 3, 4]);
	assertEquals(withTemplateRemoved(week, 3, 1).map((t) => t.weekday), [4, 3]);
});

Deno.test("weeklyTemplatesProblem: overlaps are refused around the week, separate times pass", () => {
	const at = (weekday: number, startMinute: number) => ({ weekday, startMinute });
	assertEquals(weeklyTemplatesProblem([at(1, 600), at(3, 600)], [60, 60]), null);
	assertEquals(weeklyTemplatesProblem([at(1, 600), at(1, 660)], [60, 60]), null);
	assertEquals(typeof weeklyTemplatesProblem([at(1, 600), at(1, 630)], [60, 60]), "string");
	assertEquals(typeof weeklyTemplatesProblem([at(7, 1410), at(1, 0)], [60, 60]), "string");
	assertEquals(typeof weeklyTemplatesProblem([at(2, 540), at(2, 540)], [30, 30]), "string");
});

Deno.test("variable lengths start each sitting at the listing's length and price the listing per hour (SC10)", () => {
	const on = withVariableLengths(OFFER, true);
	assertEquals(on.pricingUnit, "per_hour");
	assertEquals(on.plan.map((r) => r.durationMinutes), [60, 60, 60]);
	const off = withVariableLengths(withSessionEntry(on, 1, { durationMinutes: 90 }), false);
	assertEquals(off.plan.some((r) => r.durationMinutes !== undefined), false);
	assertEquals(off.pricingUnit, "per_hour");
	assertEquals(withVariableLengths({ ...OFFER, minutes: 10 }, true).plan[0].durationMinutes, 15);
});
