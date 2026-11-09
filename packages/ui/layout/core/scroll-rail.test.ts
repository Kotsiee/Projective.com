import { assertEquals } from "@std/assert";
import { railEdges, railPage, railWheelDelta, WHEEL_LINE_PX } from "./scroll-rail.ts";

const BOTH = { back: true, forward: true };

// #region Edges
Deno.test("railEdges — a track that fits hides nothing at either end", () => {
	assertEquals(railEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 }), {
		back: false,
		forward: false,
	});
	assertEquals(railEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400.6 }), {
		back: false,
		forward: false,
	});
});

Deno.test("railEdges — at the start only the forward end hides items", () => {
	assertEquals(railEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 }), {
		back: false,
		forward: true,
	});
});

Deno.test("railEdges — midway both ends hide items", () => {
	assertEquals(railEdges({ scrollLeft: 120, clientWidth: 300, scrollWidth: 500 }), BOTH);
});

Deno.test("railEdges — a fractional offset at the end counts as the end", () => {
	assertEquals(railEdges({ scrollLeft: 199.5, clientWidth: 300, scrollWidth: 500 }), {
		back: true,
		forward: false,
	});
});

Deno.test("railEdges — a right-to-left track reads its negative offset by size", () => {
	assertEquals(railEdges({ scrollLeft: -200, clientWidth: 300, scrollWidth: 500 }), {
		back: true,
		forward: false,
	});
	assertEquals(railEdges({ scrollLeft: -60, clientWidth: 300, scrollWidth: 500 }), BOTH);
});
// #endregion

// #region Paging
Deno.test("railPage — whole items less one, so the cut item stays as the anchor", () => {
	assertEquals(railPage(300, 56), 4 * 56);
});

Deno.test("railPage — a viewport that holds one item still moves by one", () => {
	assertEquals(railPage(80, 56), 56);
	assertEquals(railPage(40, 56), 56);
});

Deno.test("railPage — unmeasured items page by 80% of the viewport", () => {
	assertEquals(railPage(300, 0), 240);
});

Deno.test("railPage — an unlaid-out track does not move", () => {
	assertEquals(railPage(0, 56), 0);
});
// #endregion

// #region Wheel
const wheel = (deltaY: number, extra: Partial<Parameters<typeof railWheelDelta>[0]> = {}) => ({
	deltaX: 0,
	deltaY,
	deltaMode: 0,
	ctrlKey: false,
	...extra,
});

Deno.test("railWheelDelta — a vertical turn scrolls the rail along its inline axis", () => {
	assertEquals(railWheelDelta(wheel(100), BOTH, false, 300), 100);
	assertEquals(railWheelDelta(wheel(-100), BOTH, false, 300), -100);
});

Deno.test("railWheelDelta — line and page modes convert to pixels", () => {
	assertEquals(railWheelDelta(wheel(3, { deltaMode: 1 }), BOTH, false, 300), 3 * WHEEL_LINE_PX);
	assertEquals(railWheelDelta(wheel(1, { deltaMode: 2 }), BOTH, false, 300), 300);
});

Deno.test("railWheelDelta — a right-to-left rail moves the other way along scrollLeft", () => {
	assertEquals(railWheelDelta(wheel(100), BOTH, true, 300), -100);
});

Deno.test("railWheelDelta — a sideways gesture and a pinch are left to the browser", () => {
	assertEquals(railWheelDelta(wheel(10, { deltaX: 40 }), BOTH, false, 300), 0);
	assertEquals(railWheelDelta(wheel(100, { ctrlKey: true }), BOTH, false, 300), 0);
});

Deno.test("railWheelDelta — a turn toward a reached end hands the wheel back to the page", () => {
	assertEquals(railWheelDelta(wheel(100), { back: true, forward: false }, false, 300), 0);
	assertEquals(railWheelDelta(wheel(-100), { back: false, forward: true }, false, 300), 0);
});
// #endregion
