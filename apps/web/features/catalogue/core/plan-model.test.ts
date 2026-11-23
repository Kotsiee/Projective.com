import { assertEquals } from "@std/assert";
import { normaliseSessionPlan } from "@projective/types/catalogue";
import { SESSION_PLAN_MAX } from "@projective/types/explore";
import {
	canAddSession,
	hasPlan,
	planRows,
	planSummary,
	type TimedOffer,
	withSessionAdded,
	withSessionEntry,
	withSessionMoved,
	withSessionRemoved,
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
