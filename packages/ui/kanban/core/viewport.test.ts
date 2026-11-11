import { assertEquals } from "@std/assert";
import {
	boardWheelDelta,
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
