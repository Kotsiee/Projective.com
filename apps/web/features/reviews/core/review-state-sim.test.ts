import { assertEquals } from "@std/assert";
import { reviewStateOf } from "@projective/types/reviews";
import { applyReviewStateSim, parseReviewStateSim } from "./review-state-sim.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");

Deno.test("review-state sim: only a known state is read back", () => {
	assertEquals(parseReviewStateSim("locked"), "locked");
	assertEquals(parseReviewStateSim("LOCKED"), null);
	assertEquals(parseReviewStateSim(""), null);
	assertEquals(parseReviewStateSim(undefined), null);
});

Deno.test("review-state sim: no simulation passes the items through untouched", () => {
	assertEquals(applyReviewStateSim([], null, NOW), []);
});

Deno.test("review-state sim: a simulation over nothing to review gives one sample, in each state", () => {
	for (const state of ["open", "reviewed", "locked", "withdrawn", "closed"] as const) {
		const items = applyReviewStateSim([], state, NOW);
		assertEquals(items.length, 1, state);
		assertEquals(reviewStateOf(items[0]), state, state);
	}
});

Deno.test("review-state sim: a closed window is in the past, an open one in the future", () => {
	const [closed] = applyReviewStateSim([], "closed", NOW);
	const [open] = applyReviewStateSim([], "open", NOW);
	assertEquals(Date.parse(closed.closes_at) < NOW, true);
	assertEquals(Date.parse(open.closes_at) > NOW, true);
});
