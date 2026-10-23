import { assertEquals } from "@std/assert";
import {
	overflowsTrack,
	shouldCollapseTabs,
	stepIndex,
	SWIPE_THRESHOLD_PX,
	swipeStep,
	TRACK_SLACK_PX,
} from "./tab-strip.ts";

// #region shouldCollapseTabs
Deno.test("shouldCollapseTabs — a strip with room either side for the actions stays expanded", () => {
	// side = (900 − 400) / 2 − 12 = 238 ≥ 140 + 12
	assertEquals(
		shouldCollapseTabs({ headerInner: 900, tabsNatural: 400, actionsContent: 140, gap: 12 }, 6),
		false,
	);
});

Deno.test("shouldCollapseTabs — collapses once the centred strip would reach the actions", () => {
	// side = (700 − 400) / 2 − 12 = 138 < 152
	assertEquals(
		shouldCollapseTabs({ headerInner: 700, tabsNatural: 400, actionsContent: 140, gap: 12 }, 6),
		true,
	);
});

Deno.test("shouldCollapseTabs — 'approaching' counts: one gap of clearance is required", () => {
	// side = 140 exactly the tray width, but short of tray + gap
	const g = { headerInner: 704, tabsNatural: 400, actionsContent: 140, gap: 12 };
	assertEquals(shouldCollapseTabs(g, 6), true);
	assertEquals(shouldCollapseTabs({ ...g, headerInner: 728 }, 6), false);
});

Deno.test("shouldCollapseTabs — a single tab never collapses (nothing to step to)", () => {
	assertEquals(
		shouldCollapseTabs({ headerInner: 100, tabsNatural: 400, actionsContent: 140, gap: 12 }, 1),
		false,
	);
});
// #endregion

// #region overflowsTrack
Deno.test("overflowsTrack — a strip that fits its track stays expanded", () => {
	assertEquals(overflowsTrack(240, 180, 3), false);
});

Deno.test("overflowsTrack — collapses once the natural strip is wider than its track", () => {
	assertEquals(overflowsTrack(240, 260, 3), true);
});

Deno.test("overflowsTrack — sub-pixel rounding between the two widths is not an overflow", () => {
	assertEquals(overflowsTrack(240, 240 + TRACK_SLACK_PX, 3), false);
	assertEquals(overflowsTrack(240, 240 + TRACK_SLACK_PX + 0.5, 3), true);
});

Deno.test("overflowsTrack — a single tab, or a track not laid out yet, never collapses", () => {
	assertEquals(overflowsTrack(100, 400, 1), false);
	assertEquals(overflowsTrack(0, 400, 3), false);
});
// #endregion

// #region stepIndex
Deno.test("stepIndex — wraps forward past the last tab to the first", () => {
	assertEquals(stepIndex(4, 1, 5), 0);
	assertEquals(stepIndex(1, 1, 5), 2);
});

Deno.test("stepIndex — wraps backward past the first tab to the last", () => {
	assertEquals(stepIndex(0, -1, 5), 4);
	assertEquals(stepIndex(3, -1, 5), 2);
});

Deno.test("stepIndex — an empty ring resolves to 0", () => {
	assertEquals(stepIndex(0, 1, 0), 0);
});
// #endregion

// #region swipeStep
Deno.test("swipeStep — a left swipe advances, a right swipe goes back", () => {
	assertEquals(swipeStep(-60, 4), 1);
	assertEquals(swipeStep(60, -4), -1);
});

Deno.test("swipeStep — a tap-sized movement is not a swipe", () => {
	assertEquals(swipeStep(SWIPE_THRESHOLD_PX - 1, 0), 0);
	assertEquals(swipeStep(-(SWIPE_THRESHOLD_PX - 1), 0), 0);
});

Deno.test("swipeStep — a mostly vertical drag is a scroll, not a swipe", () => {
	assertEquals(swipeStep(50, 80), 0);
});
// #endregion
