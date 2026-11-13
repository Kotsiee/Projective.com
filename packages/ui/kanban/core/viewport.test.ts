import { assert, assertEquals } from "@std/assert";
import {
	boardWheelDelta,
	EDGE_MAX_SPEED,
	edgeScrollVelocity,
	settleTarget,
	snapTarget,
	WHEEL_LINE_PX,
	wheelPixels,
	wheelStaysInColumn,
} from "./viewport.ts";

const wheel = (deltaX: number, deltaY: number, opts: { mode?: number; shift?: boolean } = {}) => ({
	deltaX,
	deltaY,
	deltaMode: opts.mode ?? 0,
	shiftKey: opts.shift ?? false,
});

Deno.test("a wheel delta is converted to px from lines and pages", () => {
	assertEquals(wheelPixels(3, 0, 800), 3);
	assertEquals(wheelPixels(3, 1, 800), 3 * WHEEL_LINE_PX);
	assertEquals(wheelPixels(1, 2, 800), 800);
});

Deno.test("a vertical turn travels the inline axis 1:1, mirrored in RTL", () => {
	assertEquals(boardWheelDelta(wheel(0, 120), 800, false), 120);
	assertEquals(boardWheelDelta(wheel(0, 120), 800, true), -120);
	assertEquals(boardWheelDelta(wheel(0, -40, { shift: true }), 800, false), -40);
});

Deno.test("a horizontal swipe is physical in both directions", () => {
	assertEquals(boardWheelDelta(wheel(60, 10), 800, false), 60);
	assertEquals(boardWheelDelta(wheel(60, 10), 800, true), 60);
});

Deno.test("a vertical wheel over a scrollable column stays in the column", () => {
	assertEquals(wheelStaysInColumn(wheel(0, 100), true), true);
	assertEquals(wheelStaysInColumn(wheel(0, 100), false), false);
	assertEquals(wheelStaysInColumn(wheel(0, 100, { shift: true }), true), false);
	assertEquals(wheelStaysInColumn(wheel(80, 10), true), false);
});

Deno.test("the board settles on the nearest column start", () => {
	const starts = [0, 284, 568, 852];
	assertEquals(snapTarget(300, starts, 0, 1000), 284);
	assertEquals(snapTarget(450, starts, 0, 1000), 568);
});

Deno.test("no snap at an edge, without overflow, or on the target already", () => {
	const starts = [0, 284, 568, 852];
	assertEquals(snapTarget(0, starts, 0, 1000), null);
	assertEquals(snapTarget(1000, starts, 0, 1000), null);
	assertEquals(snapTarget(10, starts, 0, 0.5), null);
	assertEquals(snapTarget(284.2, starts, 0, 1000), null);
});

Deno.test("a snap past the last reachable offset is clamped to it", () => {
	assertEquals(snapTarget(860, [0, 284, 568, 852, 1136], 0, 900), 852);
	assertEquals(snapTarget(-300, [0, -284, -568], -700, 0), -284);
});

/** Four 272px columns with a 12px gap: starts 0 · 284 · 568 · 852, viewed 700px wide. */
const COLS = [0, 284, 568, 852].map((leftAt) => ({ leftAt, width: 272 }));

Deno.test("settling after a leftward scroll brings the leftmost column in view flush left", () => {
	assertEquals(settleTarget(400, COLS, 700, 0, 424, -1), 284);
	assertEquals(settleTarget(100, COLS, 700, 0, 424, -1), 0);
});

Deno.test("settling after a rightward scroll brings the rightmost column in view flush right", () => {
	// Viewport 300…1000 shows the fourth column partly (852…1124): its right edge lands on 1000+.
	assertEquals(settleTarget(300, COLS, 700, 0, 424, 1), 424);
	// Viewport 50…750 shows the third column partly (568…840): its end goes flush right.
	assertEquals(settleTarget(50, COLS, 700, 0, 424, 1), 140);
});

Deno.test("a settle in a gap aligns the neighbouring column, never past the bounds", () => {
	assertEquals(settleTarget(278, COLS, 700, 0, 424, -1), 284);
	assertEquals(settleTarget(130, COLS, 700, 0, 135, 1), 135);
});

Deno.test("no direction falls back to the nearest start; edges and no overflow do nothing", () => {
	assertEquals(settleTarget(300, COLS, 700, 0, 424, 0), 284);
	assertEquals(settleTarget(0, COLS, 700, 0, 424, -1), null);
	assertEquals(settleTarget(424, COLS, 700, 0, 424, 1), null);
	assertEquals(settleTarget(10, COLS, 700, 0, 0.5, 1), null);
	assertEquals(settleTarget(284, COLS, 700, 0, 424, -1), null);
});

Deno.test("a right-to-left board settles in the same physical terms", () => {
	// The same layout with `scrollLeft` running -424…0, the start column flush right at 0.
	const rtl = COLS.map((c) => ({ leftAt: c.leftAt - 424, width: c.width }));
	assertEquals(settleTarget(-24, rtl, 700, -424, 0, -1), -140);
	assertEquals(settleTarget(-374, rtl, 700, -424, 0, 1), -284);
});

Deno.test("edge auto-scroll is zero mid-board and rises linearly to full speed at the edge", () => {
	assertEquals(edgeScrollVelocity(500, 0, 1000), 0);
	assertEquals(edgeScrollVelocity(0, 0, 1000), -EDGE_MAX_SPEED);
	assertEquals(edgeScrollVelocity(1000, 0, 1000), EDGE_MAX_SPEED);
	assertEquals(edgeScrollVelocity(40, 0, 1000), -EDGE_MAX_SPEED / 2);
	assertEquals(edgeScrollVelocity(960, 0, 1000), EDGE_MAX_SPEED / 2);
	assertEquals(edgeScrollVelocity(-50, 0, 1000), -EDGE_MAX_SPEED);
	assertEquals(edgeScrollVelocity(80, 0, 1000), 0);
});

Deno.test("a narrow board shrinks its edge zones so they never meet", () => {
	assertEquals(edgeScrollVelocity(150, 0, 300), 0);
	assert(edgeScrollVelocity(70, 0, 300) < 0);
	assertEquals(edgeScrollVelocity(0, 0, 0), 0);
});
