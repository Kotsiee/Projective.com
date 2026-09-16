import { assertEquals } from "@std/assert";
import {
	clampRange,
	nearestMilestone,
	nearestOfPair,
	resolvePairMove,
	snapValue,
} from "./range.ts";

/**
 * The range core is the ONE implementation `Slider`, `RangeSlider` and `MilestoneSlider` share, so
 * what is protected here is the rule itself: where a handle lands, and — the part a pointer handler
 * cannot be trusted to get right by inspection — which handle a value belongs to after two of them
 * have crossed. A drag cannot be observed by a static assertion, so the crossing is asserted as the
 * pure function of (which handle moved, where to, where the other one is).
 */

// #region Snap + clamp
Deno.test("snapValue lands on the step grid anchored at min and clamps to the track", () => {
	assertEquals(snapValue(37, 0, 100, 10), 40);
	assertEquals(snapValue(34, 0, 100, 10), 30);
	assertEquals(snapValue(-20, 0, 100, 10), 0);
	assertEquals(snapValue(999, 0, 100, 10), 100);
	assertEquals(snapValue(7, 5, 20, 5), 5);
});

Deno.test("snapValue trims float residue and survives a zero step", () => {
	assertEquals(snapValue(0.3, 0, 1, 0.1), 0.3);
	assertEquals(snapValue(2.5, 0, 5, 0), 3);
	assertEquals(clampRange(5, 1, 3), 3);
});
// #endregion

// #region Crossing
Deno.test("without allowCross the moving handle stops at its neighbour", () => {
	assertEquals(resolvePairMove(0, 80, 60, false, false), { pair: [60, 60], swapped: false });
	assertEquals(resolvePairMove(1, 10, 40, false, false), { pair: [40, 40], swapped: false });
	assertEquals(resolvePairMove(0, 20, 60, false, false), { pair: [20, 60], swapped: false });
});

Deno.test("with allowCross the lower handle dragged past the upper becomes the upper", () => {
	const move = resolvePairMove(0, 80, 60, false, true);
	assertEquals(move.pair, [60, 80]);
	assertEquals(move.swapped, true);
});

Deno.test("with allowCross the upper handle dragged below the lower becomes the lower", () => {
	const move = resolvePairMove(1, 10, 40, false, true);
	assertEquals(move.pair, [10, 40]);
	assertEquals(move.swapped, true);
});

Deno.test("a swapped handle dragged back across restores the original orientation", () => {
	// DOM handle 0 currently holds the upper end (swapped); moving it below the other un-swaps.
	const move = resolvePairMove(0, 30, 60, true, true);
	assertEquals(move.pair, [30, 60]);
	assertEquals(move.swapped, false);
});

Deno.test("landing exactly on the twin keeps the previous orientation", () => {
	assertEquals(resolvePairMove(0, 50, 50, true, true).swapped, true);
	assertEquals(resolvePairMove(1, 50, 50, false, true).swapped, false);
});

Deno.test("the emitted pair is always ordered whichever handle produced it", () => {
	const cases = [[0, 90, 10, false], [1, 5, 95, true], [0, 50, 50, false]] as const;
	for (const [index, next, other, swapped] of cases) {
		const { pair } = resolvePairMove(index, next, other, swapped, true);
		assertEquals(pair[0] <= pair[1], true);
	}
});

Deno.test("nearestOfPair picks the closer handle and ties go to the lower", () => {
	assertEquals(nearestOfPair([10, 90], 20), 0);
	assertEquals(nearestOfPair([10, 90], 80), 1);
	assertEquals(nearestOfPair([10, 90], 50), 0);
});
// #endregion

// #region Milestones
const STOPS = [
	{ value: 1, label: "Same day" },
	{ value: 3, label: "1–3 days" },
	{ value: 7, label: "1 week" },
	{ value: 30, label: "1 month" },
] as const;

Deno.test("nearestMilestone resolves a value between stops to the closer one", () => {
	assertEquals(nearestMilestone(STOPS, 3), 1);
	assertEquals(nearestMilestone(STOPS, 6), 2);
	assertEquals(nearestMilestone(STOPS, 20), 3);
});

Deno.test("nearestMilestone lands out-of-track values on the nearest end and ties on the earlier", () => {
	assertEquals(nearestMilestone(STOPS, -50), 0);
	assertEquals(nearestMilestone(STOPS, 400), 3);
	assertEquals(nearestMilestone(STOPS, 2), 0);
	assertEquals(nearestMilestone([], 5), 0);
});
// #endregion
