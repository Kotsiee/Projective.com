/**
 * The row geometry, pinned. The hovered lane's expansion is the whole reason these are functions
 * rather than multiplications, so every test here has an expanded lane somewhere in it.
 */
import { assert, assertEquals } from "@std/assert";
import { DAY } from "../../calendar/core/time.ts";
import {
	contentHeight,
	dependencyPath,
	hitBox,
	hitTestItems,
	itemBox,
	laneAtY,
	laneHeight,
	laneTop,
	laneWindow,
	MILESTONE_HIT_PX,
	MIN_BAR_PX,
	type RowGeometry,
} from "./layout.ts";

const ORIGIN = Date.parse("2026-07-13T00:00:00Z");
const flat: RowGeometry = { rowH: 40, laneCount: 6, hoverLane: null, expandPx: 0 };
const expanded: RowGeometry = { rowH: 40, laneCount: 6, hoverLane: 2, expandPx: 22 };

Deno.test("laneTop / laneHeight — rows below the hovered lane shift by exactly the expansion", () => {
	assertEquals(laneTop(2, flat), 80);
	assertEquals(laneTop(2, expanded), 80);
	assertEquals(laneHeight(2, expanded), 62);
	assertEquals(laneTop(3, expanded), 142);
	assertEquals(laneTop(1, expanded), 40);
	assertEquals(contentHeight(flat), 240);
	assertEquals(contentHeight(expanded), 262);
	assertEquals(contentHeight({ ...expanded, laneCount: 0 }), 0);
});

Deno.test("laneAtY — inverts laneTop everywhere, including inside and below the expansion", () => {
	for (const g of [flat, expanded]) {
		for (let i = 0; i < g.laneCount; i++) {
			const top = laneTop(i, g);
			assertEquals(laneAtY(top, g), i, `top of ${i}`);
			assertEquals(laneAtY(top + laneHeight(i, g) - 1, g), i, `bottom of ${i}`);
		}
	}
	assertEquals(laneAtY(-1, flat), null);
	assertEquals(laneAtY(240, flat), null);
	assertEquals(laneAtY(261, expanded), 5);
	assertEquals(laneAtY(262, expanded), null);
});

Deno.test("laneWindow — clamps to the lane range and carries the overscan", () => {
	assertEquals(laneWindow(0, 100, flat, 1), { first: 0, last: 3 });
	assertEquals(laneWindow(100, 100, flat, 0), { first: 2, last: 5 });
	assertEquals(laneWindow(0, 10_000, flat, 2), { first: 0, last: 5 });
	assertEquals(laneWindow(0, 100, { ...flat, laneCount: 0 }), { first: 0, last: -1 });
});

Deno.test("itemBox — a bar keeps the base row height in an expanded lane; a milestone is a centred square", () => {
	const bar = itemBox(
		{ id: "a", kind: "bar", start: ORIGIN, end: ORIGIN + 2 * DAY },
		2,
		expanded,
		ORIGIN,
		40,
		8,
		12,
	);
	assertEquals(bar, { id: "a", laneIndex: 2, x: 0, y: 88, w: 80, h: 24, milestone: false });
	const pin = itemBox(
		{ id: "m", kind: "milestone", start: ORIGIN + DAY, end: ORIGIN + DAY },
		3,
		expanded,
		ORIGIN,
		40,
		8,
		12,
	);
	assertEquals(pin, { id: "m", laneIndex: 3, x: 34, y: 156, w: 12, h: 12, milestone: true });
});

Deno.test("itemBox — an instant declared as a bar is still drawn as a milestone, and a sliver keeps a floor width", () => {
	const instant = itemBox(
		{ id: "i", kind: "bar", start: ORIGIN, end: ORIGIN },
		0,
		flat,
		ORIGIN,
		40,
		8,
		12,
	);
	assertEquals(instant.milestone, true);
	const sliver = itemBox(
		{ id: "s", kind: "bar", start: ORIGIN, end: ORIGIN + 1000 },
		0,
		flat,
		ORIGIN,
		0.6,
		8,
		12,
	);
	assertEquals(sliver.w, MIN_BAR_PX);
});

Deno.test("hitBox — widens a narrow target symmetrically and leaves a wide one alone", () => {
	const narrow = hitBox({ id: "m", laneIndex: 0, x: 100, y: 0, w: 12, h: 12, milestone: true });
	assertEquals(narrow.w, MILESTONE_HIT_PX);
	assertEquals(narrow.x, 100 - (MILESTONE_HIT_PX - 12) / 2);
	const wide = { id: "b", laneIndex: 0, x: 0, y: 0, w: 200, h: 24, milestone: false };
	assertEquals(hitBox(wide), wide);
});

Deno.test("hitTestItems — the LAST painted box wins where two overlap, and a miss is null", () => {
	const under = { id: "under", laneIndex: 0, x: 0, y: 8, w: 200, h: 24, milestone: false };
	const over = { id: "over", laneIndex: 0, x: 50, y: 8, w: 60, h: 24, milestone: false };
	assertEquals(hitTestItems([under, over], 60, 20)?.id, "over");
	assertEquals(hitTestItems([under, over], 10, 20)?.id, "under");
	assertEquals(hitTestItems([under, over], 10, 60), null);
});

Deno.test("dependencyPath — runs out of the predecessor's end and into the successor's start", () => {
	const from = { id: "a", laneIndex: 0, x: 0, y: 8, w: 100, h: 24, milestone: false };
	const to = { id: "b", laneIndex: 1, x: 160, y: 48, w: 100, h: 24, milestone: false };
	const path = dependencyPath(from, to);
	assertEquals(path[0], { x: 100, y: 20 });
	assertEquals(path[path.length - 1], { x: 160, y: 60 });
	assertEquals(path.length, 4, "a successor to the right takes the short route");
	const behind = { ...to, x: 40 };
	const detour = dependencyPath(from, behind);
	assertEquals(detour.length, 6, "a successor behind routes around");
	assert(detour.every((p, i) => i === 0 || p.x !== detour[i - 1].x || p.y !== detour[i - 1].y));
});
