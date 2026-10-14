import { assert, assertEquals } from "@std/assert";
import {
	areaGeometry,
	chartTier,
	compactCount,
	compactMoney,
	DEFAULT_TIER_POLICY,
	deltaDirection,
	funnelGeometry,
	heatSteps,
	nearestIndex,
	percentLabel,
	sparkGeometry,
	stepCell,
	stepIndex,
	timeAxis,
} from "./geometry.ts";

// #region Area
const flow = (rows: [number, number][]) => [
	{ values: rows.map(([i]) => i) },
	{ values: rows.map(([, o]) => o), invert: true },
	{ values: rows.map(([i, o]) => i - o), mark: "line" as const },
];

Deno.test("a diverging chart puts an inverted series below the zero line, on one shared scale", () => {
	const geo = areaGeometry(flow([[1000, 0], [0, 500], [400, 400]]));
	const [up, down, net] = geo.series;
	assert(geo.zero > 0 && geo.zero < 1);
	assert(up.ys[0] < geo.zero);
	assert(down.ys[1] > geo.zero);
	assertEquals(net.ys[2], geo.zero);
	assertEquals(geo.xs, [0, 0.5, 1]);
	assert(up.path.startsWith("M"));
	assert(net.path.startsWith("M"));
	assert(geo.ticks.some((t) => t.value === 0));
	const sorted = [...geo.ticks].sort((a, b) => b.value - a.value);
	assertEquals(sorted.map((t) => t.ratio), [...sorted.map((t) => t.ratio)].sort((a, b) => a - b));
});

Deno.test("a positive-only chart sits on a bottom baseline", () => {
	const geo = areaGeometry([{ values: [1, 4, 2] }]);
	assertEquals(geo.zero, 1);
	assert(geo.series[0].ys.every((y) => y >= 0 && y <= 1));
});

Deno.test("an empty window still draws a frame, and one bucket sits in the middle", () => {
	const empty = areaGeometry(flow([]));
	assertEquals(empty.series[0].path, "");
	assert(empty.zero > 0 && empty.zero <= 1);
	assertEquals(areaGeometry(flow([[0, 0]])).xs, [0.5]);
});

Deno.test("a non-finite value never reaches a path", () => {
	const geo = areaGeometry([{ values: [1, Number.NaN, 3] }]);
	assert(!/NaN/.test(geo.series[0].path));
});
// #endregion

// #region Navigation
Deno.test("the crosshair snaps to the nearest bucket", () => {
	assertEquals(nearestIndex(0, 10), 0);
	assertEquals(nearestIndex(1, 10), 9);
	assertEquals(nearestIndex(0.52, 3), 1);
	assertEquals(nearestIndex(-0.4, 3), 0);
	assertEquals(nearestIndex(0.7, 1), 0);
});

Deno.test("←/→ step the focused point, Home/End jump, Escape clears, other keys pass", () => {
	assertEquals(stepIndex(null, "ArrowRight", 5), 0);
	assertEquals(stepIndex(null, "ArrowLeft", 5), 4);
	assertEquals(stepIndex(4, "ArrowRight", 5), 4);
	assertEquals(stepIndex(2, "ArrowLeft", 5), 1);
	assertEquals(stepIndex(2, "Home", 5), 0);
	assertEquals(stepIndex(2, "End", 5), 4);
	assertEquals(stepIndex(2, "Escape", 5), null);
	assertEquals(stepIndex(2, "a", 5), undefined);
	assertEquals(stepIndex(null, "ArrowRight", 0), undefined);
});

Deno.test("heatmap keys move along rows and across them, clamped to the grid", () => {
	assertEquals(stepCell(null, "ArrowRight", 7, 24), { row: 0, col: 0 });
	assertEquals(stepCell({ row: 0, col: 23 }, "ArrowRight", 7, 24), { row: 0, col: 23 });
	assertEquals(stepCell({ row: 6, col: 3 }, "ArrowDown", 7, 24), { row: 6, col: 3 });
	assertEquals(stepCell({ row: 2, col: 3 }, "ArrowUp", 7, 24), { row: 1, col: 3 });
	assertEquals(stepCell({ row: 2, col: 3 }, "End", 7, 24), { row: 2, col: 23 });
	assertEquals(stepCell({ row: 2, col: 3 }, "Escape", 7, 24), null);
	assertEquals(stepCell({ row: 2, col: 3 }, "x", 7, 24), undefined);
});
// #endregion

// #region Funnel & heatmap
Deno.test("a funnel step carries its share of the first step and its drop-off", () => {
	const steps = funnelGeometry([
		{ label: "Impressions", value: 1000 },
		{ label: "Views", value: 400 },
		{ label: "Checkout", value: 100 },
		{ label: "Orders", value: 0 },
	]);
	assertEquals(steps.map((s) => s.ratio), [1, 0.4, 0.1, 0]);
	assertEquals(steps[0].dropOff, null);
	assertEquals(steps[1].ofFirst, 0.4);
	assertEquals(steps[1].dropOff, 0.6);
	assertEquals(steps[2].dropOff, 0.75);
	assertEquals(steps[3].dropOff, 1);
	assertEquals(
		funnelGeometry([{ label: "a", value: 0 }, { label: "b", value: 0 }])[1].ofFirst,
		null,
	);
});

Deno.test("shares print as whole percents, with a sliver as <1%", () => {
	assertEquals(percentLabel(0.4), "40%");
	assertEquals(percentLabel(0.004), "<1%");
	assertEquals(percentLabel(0), "0%");
	assertEquals(percentLabel(null), "—");
});

Deno.test("heat steps bucket values onto five steps above an empty step", () => {
	assertEquals(heatSteps([[0, 1, 5, 10], [2, 3, 7, 8]]), [[0, 1, 3, 5], [1, 2, 4, 4]]);
	assertEquals(heatSteps([[0, 0], [0, 0]]), [[0, 0], [0, 0]]);
	assertEquals(heatSteps([[-1, Number.NaN, 4]]), [[0, 0, 5]]);
});
// #endregion

// #region Sparkline
Deno.test("a sparkline needs two points, and a flat series runs through the middle", () => {
	assertEquals(sparkGeometry([3]).line, "");
	const flat = sparkGeometry([2, 2, 2]);
	assert(flat.line.startsWith("M"));
	assertEquals(flat.points.map((p) => p.y), [0.5, 0.5, 0.5]);
	const rising = sparkGeometry([0, 10]);
	assert(rising.points[1].y < rising.points[0].y);
	assertEquals(rising.points.map((p) => p.x), [0, 1]);
});
// #endregion

// #region Tier
Deno.test("SVG at low density, Canvas2D past the entity threshold or the frame budget", () => {
	assertEquals(chartTier(100), "svg");
	assertEquals(chartTier(DEFAULT_TIER_POLICY.threshold + 1), "canvas");
	assertEquals(chartTier(100, 2), "svg");
	assertEquals(chartTier(100, DEFAULT_TIER_POLICY.budgetMs + 1), "canvas");
	assertEquals(chartTier(50, null, { threshold: 10, budgetMs: 8 }), "canvas");
});
// #endregion

// #region Labels & time axis
Deno.test("axis figures are compact and keep the currency", () => {
	assertEquals(compactMoney(1_250_000, "GBP"), "£12.5K");
	assertEquals(compactMoney(-150_000, "GBP"), "−£1.5K");
	assertEquals(compactMoney(500, "JPY").includes("500"), true);
	assertEquals(compactCount(1284), "1,284");
	assertEquals(compactCount(12_900), "12.9K");
	assertEquals(compactCount(4_200_000), "4.2M");
});

Deno.test("a delta's direction is read from its sign, typographic minus included", () => {
	assertEquals(deltaDirection("+12%"), "up");
	assertEquals(deltaDirection("−£240"), "down");
	assertEquals(deltaDirection("-3"), "down");
	assertEquals(deltaDirection("0"), "flat");
	assertEquals(deltaDirection(null), "flat");
});

Deno.test("only dated items are placed, on an axis at least a fortnight long", () => {
	const now = Date.parse("2026-10-06T12:00:00Z");
	const axis = timeAxis(
		[{ id: "a", at: "2026-10-09T12:00:00Z", state: "pending" }, {
			id: "b",
			at: null,
			state: "locked",
		}],
		now,
		14,
		"UTC",
	);
	assertEquals(axis.placed.map((p) => p.id), ["a"]);
	assertEquals(axis.placed[0].item.state, "pending");
	assertEquals(axis.to - axis.from, 14 * 86_400_000);
	assertEquals(Math.round(axis.placed[0].ratio * 14), 3);
	assertEquals(axis.ticks[0], { label: "Today", ratio: 0 });
	assert(axis.ticks.length >= 2);
});
// #endregion
