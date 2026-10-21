import { assert, assertEquals } from "@std/assert";
import {
	connectorPath,
	fitView,
	GAP_X,
	GAP_Y,
	layoutChart,
	managersAbove,
	NODE_H,
	NODE_W,
	revealBox,
	shapeChart,
	zoomAbout,
} from "./org-chart-layout.ts";

/**
 * The Members org chart's geometry (Decision #319): the reporting structure it is honest about, where
 * every card sits, the connectors, and the viewport arithmetic the canvas and the footer rig share.
 */

interface P {
	id: string;
	reportsTo: string | null;
}
const p = (id: string, reportsTo: string | null = null): P => ({ id, reportsTo });
const ids = (list: readonly { id: string }[]) => list.map((m) => m.id);

// #region Shape
Deno.test("org chart: managers, reports and the order given", () => {
	const shape = shapeChart([
		p("kwame"),
		p("samuel", "kwame"),
		p("tomasz", "samuel"),
		p("ana", "kwame"),
	]);
	assertEquals(ids(shape.roots), ["kwame"]);
	assertEquals(ids(shape.reportsOf.get("kwame") ?? []), ["samuel", "ana"]);
	assertEquals(managersAbove(shape, "tomasz"), ["samuel", "kwame"]);
	assertEquals(managersAbove(shape, "kwame"), []);
	assertEquals(shape.unplaced, []);
});

Deno.test("org chart: a missing manager, a cycle and a rootless roster are not placed", () => {
	const shape = shapeChart([
		p("owner"),
		p("stale", "gone"),
		p("a", "b"),
		p("b", "a"),
		p("self", "self"),
	]);
	assertEquals(ids(shape.roots), ["owner"]);
	assertEquals(ids(shape.unplaced), ["stale", "a", "b", "self"]);
	assertEquals(managersAbove(shape, "a"), []);
	// Nobody at the top: nobody is placed, and the layout says so.
	const rootless = layoutChart([p("a", "b"), p("b", "a")]);
	assertEquals(rootless.rooted, false);
	assert(rootless.nodes.every((n) => n.unplaced));
	assertEquals(rootless.unplacedLabel, { x: 0, y: 0 });
});
// #endregion

// #region Layout
Deno.test("org chart: a manager is centred over their reports, one level per row", () => {
	const layout = layoutChart([p("m"), p("a", "m"), p("b", "m")]);
	const at = (id: string) => layout.nodes.find((n) => n.member.id === id)!;
	assertEquals(ids(layout.nodes.map((n) => n.member)), ["m", "a", "b"]);
	assertEquals([at("a").y, at("b").y], [NODE_H + GAP_Y, NODE_H + GAP_Y]);
	assertEquals(at("b").x - at("a").x, NODE_W + GAP_X);
	assertEquals(at("m").x + NODE_W / 2, (at("a").x + at("b").x + NODE_W) / 2);
	assertEquals([at("m").level, at("a").level], [1, 2]);
	assertEquals([at("m").reports, at("m").descendants, at("m").open], [2, 2, true]);
	assertEquals(at("a").parentId, "m");
	assertEquals(layout.edges.map((e) => e.id), ["m>a", "m>b"]);
	assertEquals(layout.bounds, {
		x: 0,
		y: 0,
		width: 2 * NODE_W + GAP_X,
		height: 2 * NODE_H + GAP_Y,
	});
});

Deno.test("org chart: subtrees never overlap, and several people at the top sit side by side", () => {
	const layout = layoutChart([
		p("r1"),
		p("a", "r1"),
		p("a1", "a"),
		p("a2", "a"),
		p("a3", "a"),
		p("b", "r1"),
		p("r2"),
	]);
	const rows = new Map<number, number[]>();
	for (const n of layout.nodes) {
		rows.set(
			n.y,
			[...(rows.get(n.y) ?? []), n.x].sort((x, y) => x - y),
		);
	}
	for (const xs of rows.values()) {
		for (let i = 1; i < xs.length; i++) {
			assert(xs[i] - xs[i - 1] >= NODE_W + GAP_X, `overlap ${xs}`);
		}
	}
	const r2 = layout.nodes.find((n) => n.member.id === "r2")!;
	assertEquals([r2.y, r2.level, r2.parentId], [0, 1, null]);
});

Deno.test("org chart: a closed branch keeps its card and its count, and hides its reports", () => {
	const members = [p("m"), p("a", "m"), p("a1", "a"), p("b", "m")];
	const layout = layoutChart(members, new Set(["a"]));
	const a = layout.nodes.find((n) => n.member.id === "a")!;
	assertEquals([a.open, a.reports, a.descendants], [false, 1, 1]);
	assert(!layout.nodes.some((n) => n.member.id === "a1"));
	assert(!layout.edges.some((e) => e.to === "a1"));
	// A leaf is never "open", whatever the set says.
	assertEquals(layoutChart(members, new Set()).nodes.find((n) => n.member.id === "b")?.open, false);
});

Deno.test("org chart: the unplaced group sits under the trees, its label above it", () => {
	const layout = layoutChart([p("m"), p("a", "m"), p("lost", "gone")]);
	const lost = layout.nodes.at(-1)!;
	assertEquals([lost.member.id, lost.unplaced, lost.level], ["lost", true, 1]);
	assert(layout.unplacedLabel !== null);
	assert(layout.unplacedLabel.y > NODE_H * 2 + GAP_Y, "the group overlaps the tree");
	assert(lost.y > layout.unplacedLabel.y);
});

Deno.test("org chart: nobody → an empty chart at the origin", () => {
	const layout = layoutChart([]);
	assertEquals([layout.nodes, layout.edges, layout.unplacedLabel], [[], [], null]);
	assertEquals(layout.bounds, { x: 0, y: 0, width: 0, height: 0 });
});
// #endregion

// #region Connectors
Deno.test("org chart: a connector runs straight when aligned, else elbows at the midline", () => {
	assertEquals(connectorPath(100, 0, 100, 64), "M100 0V64");
	const d = connectorPath(100, 0, 300, 64);
	assert(d.startsWith("M100 0V22"), d);
	assert(d.includes("H290"), d);
	assert(d.endsWith("V64"), d);
	// A short run never overshoots: the radius shrinks to half the gap.
	assert(connectorPath(100, 0, 104, 64).includes("H102"));
});
// #endregion

// #region Viewport
Deno.test("org chart: fit centres the chart and never blows a small one past its cap", () => {
	const view = fitView({ x: 0, y: 0, width: 400, height: 200 }, 1000, 600, {
		pad: 40,
		min: 0.25,
		maxFit: 1,
	});
	assertEquals(view, { x: 300, y: 200, k: 1 });
	const big = fitView({ x: 0, y: 0, width: 4000, height: 1000 }, 1000, 600, {
		pad: 50,
		min: 0.25,
		maxFit: 1,
	});
	assertEquals(big.k, 0.25);
	assertEquals(big.x, (1000 - 4000 * 0.25) / 2);
});

Deno.test("org chart: zooming about a point keeps that point under the pointer", () => {
	const before = { x: 10, y: 20, k: 1 };
	const after = zoomAbout(before, 2, 110, 220);
	// Canvas (100, 200) was at screen (110, 220) and still is.
	assertEquals([100 * after.k + after.x, 200 * after.k + after.y], [110, 220]);
});

Deno.test("org chart: reveal moves only as far as it must, and not at all when on screen", () => {
	const view = { x: 0, y: 0, k: 1 };
	const box = { x: 0, y: 0, width: 100, height: 50 };
	assertEquals(revealBox(view, { ...box, x: 100, y: 100 }, 800, 600, 20), view);
	const right = revealBox(view, { ...box, x: 900, y: 100 }, 800, 600, 20);
	assertEquals([right.x, right.y], [800 - 20 - 1000, 0]);
	const above = revealBox({ x: 0, y: 0, k: 2 }, { ...box, y: -100 }, 800, 600, 20);
	assertEquals(above.y, 20 + 200);
});
// #endregion
