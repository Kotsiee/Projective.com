import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { curveLinear, line } from "d3-shape";
import type { BurnPoint } from "../types/wallet-types.ts";
import { buildTicks, finiteOr, safePath, type Tick } from "./flow-chart.ts";

/**
 * burn-chart — the business budget burn-down geometry (BUILD CONTRACT §4.4 · §6.2).
 *
 * Planned is a dashed reference line, actual a solid one, and the divergence between them is filled
 * ONLY where actual has passed planned — an over-budget region is a fact worth drawing, and drawing
 * it only where it exists is what stops the chart implying a shortfall that has not happened.
 *
 * Unlike the cashflow chart this series is deliberately **linear, not monotone-smoothed**. A burn-down
 * is a cumulative ledger: the value between two measured points is not an unknown the chart may
 * interpolate prettily, it is a straight accumulation, and a curve through it invents intermediate
 * spend that never occurred. Linear segments also let the divergence polygon share the lines' exact
 * boundary — a smoothed line with a polygonal fill leaves a visible sliver of daylight along the very
 * edge the chart exists to call out.
 *
 * Pure and SSR-safe, like every module in the chart engine: no DOM, no clock, no measurement.
 */

// #region Geometry
/** Block-axis breathing room so the highest point never touches the plot edge. */
const CHART_PAD = 6;

/** Everything the burn-down needs to paint, resolved once and shared by SSR and the island. */
export interface BurnGeometry {
	/** The planned (budget) reference line. Empty string when there is nothing drawable. */
	planned: string;
	/** The actual cumulative-spend line. */
	actual: string;
	/**
	 * The divergence polygon, present ONLY where actual has exceeded planned — `null` when the
	 * budget is intact. An always-rendered zero-area path would still catch a stray stroke.
	 */
	over: string | null;
	/** Thinned x-axis labels. */
	ticks: Tick[];
	/** The largest value in the series, in minor units. */
	maxMinor: number;
	/** The coordinate space the paths were built in. */
	width: number;
	height: number;
}

/** One resolved sample: value-space amounts for run detection, pixel-space y for the paths. */
interface Node {
	x: number;
	/** Planned value in minor units. */
	pv: number;
	/** Actual value in minor units. */
	av: number;
	/** Planned y in viewBox units. */
	py: number;
	/** Actual y in viewBox units. */
	ay: number;
}

/** A geometry with nothing drawable — the honest answer to an empty series or a zero-size box. */
function emptyBurn(width: number, height: number): BurnGeometry {
	return { planned: "", actual: "", over: null, ticks: [], maxMinor: 0, width, height };
}

/** Clamp a transported minor-unit amount to a drawable non-negative finite number. */
function amount(minor: number): number {
	return Math.max(0, finiteOr(minor));
}

/** Linear interpolation between two finite numbers. */
function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Emit one closed polygon for a contiguous over-budget run: forward along the actual line, back
 * along the planned line. The run's endpoints are the exact crossings, so the fill meets the two
 * lines rather than approaching them.
 */
function polygon(run: readonly Node[]): string {
	if (run.length < 2) return "";
	const forward = run.map((n, i) => `${i === 0 ? "M" : "L"}${n.x},${n.ay}`).join("");
	const back = run.slice().reverse().map((n) => `L${n.x},${n.py}`).join("");
	return `${forward}${back}Z`;
}

/**
 * Build the planned/actual lines and the over-budget divergence fill.
 *
 * Degenerate inputs are handled explicitly: an empty series or a zero-size box yields nothing
 * drawable, a single sample yields no lines (a line needs two x positions to have extent), and an
 * all-zero series gets an explicit `[0, 1]` domain so the scale never divides by zero.
 */
export function buildBurn(points: BurnPoint[], width: number, height: number): BurnGeometry {
	const w = finiteOr(width);
	const h = finiteOr(height);
	const n = points.length;
	if (n === 0 || w <= 0 || h <= 0) return emptyBurn(w, h);

	const maxMinor = amount(
		max(points, (p: BurnPoint) => Math.max(amount(p.plannedMinor), amount(p.actualMinor))) ?? 0,
	);
	const y = scaleLinear()
		.domain([0, maxMinor > 0 ? maxMinor : 1])
		.range([h - CHART_PAD, CHART_PAD]);
	const xScale = scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, w]);
	const xAt = (i: number): number => (n > 1 ? finiteOr(xScale(i)) : w / 2);
	const py = (v: number): number => finiteOr(y(v), h - CHART_PAD);

	const nodes: Node[] = points.map((p, i) => {
		const pv = amount(p.plannedMinor);
		const av = amount(p.actualMinor);
		return { x: xAt(i), pv, av, py: py(pv), ay: py(av) };
	});

	let planned = "";
	let actual = "";
	if (n > 1) {
		// Accessor parameters are annotated explicitly: `d3-shape` ships no type declarations, so an
		// inline arrow's parameters would land as implicit `any` under the repo's strict settings.
		// Two generators, not one re-`.y()`d generator: a d3 line is stateful, and sharing it here
		// would make the two paths depend on evaluation order for no gain.
		const at = (d: Node): number => d.x;
		planned = safePath(line<Node>().x(at).y((d: Node) => d.py).curve(curveLinear)(nodes));
		actual = safePath(line<Node>().x(at).y((d: Node) => d.ay).curve(curveLinear)(nodes));
	}

	return {
		planned,
		actual,
		over: buildOver(nodes),
		ticks: buildTicks(points.map((p) => p.label), xAt),
		maxMinor,
		width: w,
		height: h,
	};
}
// #endregion

// #region Over-budget divergence
/**
 * Walk the series, inserting the exact crossing point wherever actual and planned swap order, then
 * emit one polygon per contiguous over-budget run. Inserting the crossing is what makes the fill
 * start and stop precisely where the two lines meet instead of at the nearest sample.
 */
function buildOver(nodes: readonly Node[]): string | null {
	if (nodes.length < 2) return null;

	const walk: Node[] = [];
	for (let i = 0; i < nodes.length; i++) {
		walk.push(nodes[i]);
		const next = nodes[i + 1];
		if (!next) continue;
		const d0 = nodes[i].av - nodes[i].pv;
		const d1 = next.av - next.pv;
		if ((d0 > 0 && d1 < 0) || (d0 < 0 && d1 > 0)) {
			const t = d0 / (d0 - d1);
			if (!Number.isFinite(t)) continue;
			const cx = lerp(nodes[i].x, next.x, t);
			const cv = lerp(nodes[i].pv, next.pv, t);
			const cy = lerp(nodes[i].py, next.py, t);
			// At a crossing the two lines are the same point by definition.
			walk.push({ x: cx, pv: cv, av: cv, py: cy, ay: cy });
		}
	}

	const paths: string[] = [];
	let run: Node[] = [];
	let strict = false;
	const flush = (): void => {
		if (run.length >= 2 && strict) {
			const d = polygon(run);
			if (d) paths.push(d);
		}
		run = [];
		strict = false;
	};

	for (const node of walk) {
		if (node.av >= node.pv) {
			run.push(node);
			if (node.av > node.pv) strict = true;
		} else {
			flush();
		}
	}
	flush();

	const joined = safePath(paths.join(""));
	return joined === "" ? null : joined;
}
// #endregion
