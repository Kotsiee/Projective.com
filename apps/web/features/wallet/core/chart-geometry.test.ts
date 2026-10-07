import { assert, assertEquals } from "@std/assert";
import type { FlowPoint, ReleaseItem } from "../types/wallet-types.ts";
import { compactMoney, flowGeometry, nearestIndex, releaseAxis } from "./chart-geometry.ts";

const point = (inMinor: number, outMinor: number, i: number): FlowPoint => ({
	label: `${i + 1} Oct`,
	start: `2026-10-0${i + 1}`,
	inMinor,
	outMinor,
	netMinor: inMinor - outMinor,
});

Deno.test("money in rises above the zero line, money out falls below it, on one shared scale", () => {
	const geo = flowGeometry([point(1000, 0, 0), point(0, 500, 1), point(400, 400, 2)]);
	assert(geo.zero > 0 && geo.zero < 1);
	// Above the baseline is a smaller ratio from the top.
	assert(geo.yIn[0] < geo.zero);
	assert(geo.yOut[1] > geo.zero);
	assertEquals(geo.yNet[2], geo.zero);
	assertEquals(geo.xs, [0, 0.5, 1]);
	assert(geo.inPath.startsWith("M"));
	assert(geo.netPath.startsWith("M"));
	assert(geo.ticks.some((t) => t.value === 0));
	// Ticks run top to bottom in ratio as values fall.
	const sorted = [...geo.ticks].sort((a, b) => b.value - a.value);
	assertEquals(sorted.map((t) => t.ratio), [...sorted.map((t) => t.ratio)].sort((a, b) => a - b));
});

Deno.test("an empty window still draws a frame, and one bucket sits in the middle", () => {
	const empty = flowGeometry([]);
	assertEquals(empty.inPath, "");
	assert(empty.zero > 0 && empty.zero <= 1);
	const one = flowGeometry([point(0, 0, 0)]);
	assertEquals(one.xs, [0.5]);
});

Deno.test("the crosshair snaps to the nearest bucket", () => {
	assertEquals(nearestIndex(0, 10), 0);
	assertEquals(nearestIndex(1, 10), 9);
	assertEquals(nearestIndex(0.52, 3), 1);
	assertEquals(nearestIndex(-0.4, 3), 0);
	assertEquals(nearestIndex(0.7, 1), 0);
});

Deno.test("axis figures are compact and keep the currency", () => {
	assertEquals(compactMoney(1_250_000, "GBP"), "£12.5K");
	// A true minus, as every other negative figure on the surface prints.
	assertEquals(compactMoney(-150_000, "GBP"), "−£1.5K");
	assertEquals(compactMoney(500, "JPY").includes("500"), true);
});

Deno.test("only dated releases are placed, on an axis at least a fortnight long", () => {
	const now = Date.parse("2026-10-06T12:00:00Z");
	const item = (id: string, at: string | null): ReleaseItem => ({
		id,
		label: id,
		href: null,
		amount: { minor: 100, currency: "GBP", display: "£1.00", origin: null },
		state: at ? "pending" : "locked",
		at,
		basis: at ? "clearing" : "awaiting_approval",
	});
	const axis = releaseAxis([item("a", "2026-10-09T12:00:00Z"), item("b", null)], now, 14, "UTC");
	assertEquals(axis.placed.map((p) => p.id), ["a"]);
	assertEquals(axis.to - axis.from, 14 * 86_400_000);
	assertEquals(Math.round(axis.placed[0].ratio * 14), 3);
	assertEquals(axis.ticks[0], { label: "Today", ratio: 0 });
	assert(axis.ticks.length >= 2);
});
