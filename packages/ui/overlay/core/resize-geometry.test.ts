import { assert, assertEquals } from "@std/assert";
import {
	GRIP_EDGES,
	RESIZE_GRIPS,
	resizeAxis,
	type ResizeBounds,
	resizeBounds,
	type ResizeRect,
	resizeRect,
} from "./resize-geometry.ts";

const VIEWPORT = { w: 1280, h: 800 };
const MARGIN = 12;
const OPEN: ResizeBounds = { minW: 256, minH: 128, maxW: Infinity, maxH: Infinity };
const BOX: ResizeRect = { x: 100, y: 100, w: 400, h: 300 };
const limits = (overrides: Partial<{ min: number; max: number }> = {}) => ({
	min: 256,
	max: Infinity,
	viewport: VIEWPORT.w,
	margin: MARGIN,
	...overrides,
});

// #region Grips
Deno.test("every grip is listed once, edges drive one axis and corners drive both", () => {
	const corners = new Set(["start-start", "start-end", "end-start", "end-end"]);
	assertEquals(new Set(RESIZE_GRIPS).size, 8);
	for (const grip of RESIZE_GRIPS) {
		const { inline, block } = GRIP_EDGES[grip];
		const driven = Math.abs(inline) + Math.abs(block);
		assertEquals(driven, corners.has(grip) ? 2 : 1, grip);
	}
});
// #endregion

// #region Axis
Deno.test("an end-edge drag grows and shrinks from a fixed start", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, 50, 1, limits()), { start: 100, size: 450 });
	assertEquals(resizeAxis({ start: 100, size: 400 }, -50, 1, limits()), { start: 100, size: 350 });
});

Deno.test("a start-edge drag keeps the far edge fixed", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, -50, -1, limits()), { start: 50, size: 450 });
	assertEquals(resizeAxis({ start: 100, size: 400 }, 50, -1, limits()), { start: 150, size: 350 });
});

Deno.test("a cross-axis edge is left untouched", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, 999, 0, limits()), { start: 100, size: 400 });
});

Deno.test("the minimum floor stops the box inverting from either edge", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, -1000, 1, limits()), {
		start: 100,
		size: 256,
	});
	assertEquals(resizeAxis({ start: 100, size: 400 }, 1000, -1, limits()), {
		start: 244,
		size: 256,
	});
	for (let delta = -2000; delta <= 2000; delta += 50) {
		const next = resizeAxis({ start: 100, size: 400 }, delta, -1, limits());
		assertEquals(next.start + next.size, 500, `far edge moved at delta ${delta}`);
		assert(next.size >= 256, `inverted at delta ${delta}`);
	}
});

Deno.test("the maximum caps growth from either edge", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, 500, 1, limits({ max: 600 })), {
		start: 100,
		size: 600,
	});
	assertEquals(resizeAxis({ start: 300, size: 400 }, -300, -1, limits({ max: 500 })), {
		start: 200,
		size: 500,
	});
});

Deno.test("a contradictory min/max resolves toward the floor", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, 0, 1, limits({ min: 300, max: 200 })), {
		start: 100,
		size: 300,
	});
});

Deno.test("the moving edge stops a margin short of the viewport", () => {
	assertEquals(resizeAxis({ start: 100, size: 400 }, 2000, 1, limits()), {
		start: 100,
		size: 1168,
	});
	assertEquals(resizeAxis({ start: 100, size: 400 }, -1000, -1, limits()), {
		start: 12,
		size: 488,
	});
});

Deno.test("an edge already past the margin may shrink back but never travels further out", () => {
	assertEquals(resizeAxis({ start: 4, size: 400 }, -10, -1, limits()), { start: 4, size: 400 });
	assertEquals(resizeAxis({ start: 4, size: 400 }, 1, -1, limits()), { start: 5, size: 399 });
	assertEquals(resizeAxis({ start: 1000, size: 400 }, 10, 1, limits()), { start: 1000, size: 400 });
	assertEquals(resizeAxis({ start: 1000, size: 400 }, -10, 1, limits()), {
		start: 1000,
		size: 390,
	});
});
// #endregion

// #region Rect
Deno.test("a corner grip moves both axes and anchors the opposite corner", () => {
	assertEquals(
		resizeRect(BOX, "start-start", { inline: -20, block: -30 }, OPEN, VIEWPORT, MARGIN),
		{ x: 80, y: 70, w: 420, h: 330 },
	);
	assertEquals(
		resizeRect(BOX, "end-end", { inline: 20, block: 30 }, OPEN, VIEWPORT, MARGIN),
		{ x: 100, y: 100, w: 420, h: 330 },
	);
	assertEquals(
		resizeRect(BOX, "start-end", { inline: 20, block: -30 }, OPEN, VIEWPORT, MARGIN),
		{ x: 100, y: 70, w: 420, h: 330 },
	);
	assertEquals(
		resizeRect(BOX, "end-start", { inline: -20, block: 30 }, OPEN, VIEWPORT, MARGIN),
		{ x: 80, y: 100, w: 420, h: 330 },
	);
});

Deno.test("an edge grip ignores travel on its cross axis", () => {
	assertEquals(
		resizeRect(BOX, "block-start", { inline: 999, block: -30 }, OPEN, VIEWPORT, MARGIN),
		{ x: 100, y: 70, w: 400, h: 330 },
	);
	assertEquals(
		resizeRect(BOX, "inline-end", { inline: 20, block: 999 }, OPEN, VIEWPORT, MARGIN),
		{ x: 100, y: 100, w: 420, h: 300 },
	);
});

Deno.test("each axis is held to its own bounds", () => {
	const bounds: ResizeBounds = { minW: 256, minH: 128, maxW: 450, maxH: Infinity };
	assertEquals(
		resizeRect(BOX, "end-end", { inline: 400, block: -1000 }, bounds, VIEWPORT, MARGIN),
		{ x: 100, y: 100, w: 450, h: 128 },
	);
});
// #endregion

// #region Bounds
Deno.test("resizeBounds reads the cascade and floors it at the caller's minimums", () => {
	assertEquals(
		resizeBounds(
			{ minWidth: "256px", minHeight: "128px", maxWidth: "1256px", maxHeight: "none" },
			{ w: 256, h: 128 },
		),
		{ minW: 256, minH: 128, maxW: 1256, maxH: Infinity },
	);
	assertEquals(
		resizeBounds(
			{ minWidth: "320px", minHeight: "auto", maxWidth: "none", maxHeight: "640px" },
			{ w: 256, h: 128 },
		),
		{ minW: 320, minH: 128, maxW: Infinity, maxH: 640 },
	);
});
// #endregion
