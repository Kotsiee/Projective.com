import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import type { FlowPoint } from "../types/wallet-types.ts";

/**
 * flow-chart — the in-vs-out cashflow geometry (BUILD CONTRACT §4.3 · §6.2 · §8).
 *
 * Decision #1 tiers the chart engine: **D3 for scales and geometry, hand-rolled low-density inline
 * SVG for the mark**. `d3-scale` and `d3-shape` do the arithmetic; nothing here touches the DOM,
 * reads a clock, or measures an element — so the server and the hydrated island produce
 * byte-identical path strings and the chart never flickers through a re-layout on hydration.
 *
 * The series is drawn MIRRORED about a central zero line — money in above it, money out below it,
 * the net line threading through — rather than stacked. Stacking in on top of out would produce a
 * combined height that means nothing (a wallet's gross throughput is not a quantity anyone spends),
 * and the two are plotted on ONE symmetric scale so a taller inflow is genuinely a bigger number
 * than a shorter outflow. Comparing two series at two scales is the chart's version of a dishonest
 * floor, and this surface does not have one anywhere.
 *
 * Every builder in the wallet's chart engine funnels its output through {@link safePath}. A single
 * `NaN` in a `d` attribute silently blanks a path in every browser, and it is the standard failure
 * of a hand-rolled chart: an empty series, a one-point series, a zero-valued series, or a
 * zero-width container all reach a divide-by-zero if the guards are left to the caller.
 */

// #region Shared chart-engine guards (used by the sibling burn + category builders)
/** Block-axis breathing room so a peak never touches the plot edge. */
const CHART_PAD = 6;

/** Ceiling on printed axis labels — beyond this they collide and stop being readable. */
const MAX_TICKS = 8;

/** One x-axis label at a position in the chart's own coordinate space. */
export interface Tick {
	/** Position along the inline axis, in viewBox units. */
	x: number;
	/** The server-supplied bucket label — never composed here. */
	label: string;
}

/**
 * Coerce a value to a finite number. Guards every arithmetic entry point: a `null` that survived a
 * transport boundary, or an `Infinity` from a degenerate ratio, must become a drawable `0` rather
 * than propagate into a path string.
 */
export function finiteOr(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback;
}

/**
 * The last line of defence before a path reaches the DOM. Any `NaN`/`Infinity` that survived the
 * guards blanks the path entirely rather than shipping a malformed `d` — a missing mark is honest,
 * a half-drawn one is not.
 */
export function safePath(d: string | null | undefined): string {
	if (!d) return "";
	return /NaN|Infinity/.test(d) ? "" : d;
}

/**
 * Thin a bucket series down to at most {@link MAX_TICKS} printed labels, always keeping the first
 * and the last so the window's true extent is readable.
 */
export function buildTicks(labels: readonly string[], xAt: (i: number) => number): Tick[] {
	const n = labels.length;
	if (n === 0) return [];
	const stride = Math.max(1, Math.ceil(n / MAX_TICKS));
	const out: Tick[] = [];
	for (let i = 0; i < n; i += stride) {
		out.push({ x: finiteOr(xAt(i)), label: labels[i] });
	}
	const last = n - 1;
	if (out.length > 0 && out[out.length - 1].label !== labels[last]) {
		// Replace rather than append when the penultimate tick would crowd the final one.
		if (last - (out.length - 1) * stride < stride / 2) out.pop();
		out.push({ x: finiteOr(xAt(last)), label: labels[last] });
	}
	return out;
}
// #endregion

// #region Flow geometry
/** The single largest bucket in the series, marked with a dot and named in the readout. */
export interface Peak {
	/** Inline position in viewBox units. */
	x: number;
	/** Block position in viewBox units. */
	y: number;
	/** The bucket's own label. */
	label: string;
	/** The bucket's value in MINOR units — the caller formats it, never this module. */
	value: number;
	/** Which side of the zero line the peak sits on. */
	kind: "in" | "out";
}

/** Everything the flow chart needs to paint, resolved once and shared by SSR and the island. */
export interface FlowGeometry {
	/** Filled area above the zero line. Empty string when there is nothing drawable. */
	inArea: string;
	/** Filled area below the zero line. */
	outArea: string;
	/** The net (in − out) through-line. */
	netLine: string;
	/** Thinned x-axis labels. */
	ticks: Tick[];
	/** The series maximum, or `null` for an empty or all-zero series — never a fabricated mark. */
	peak: Peak | null;
	/** The largest single bucket value in minor units; `0` for an all-zero series. */
	maxMinor: number;
	/** The coordinate space the paths were built in. */
	width: number;
	height: number;
}

/** A geometry with nothing drawable — the honest answer to an empty series or a zero-size box. */
function emptyFlow(width: number, height: number): FlowGeometry {
	return {
		inArea: "",
		outArea: "",
		netLine: "",
		ticks: [],
		peak: null,
		maxMinor: 0,
		width,
		height,
	};
}

/** Clamp a transported minor-unit amount to a drawable non-negative finite number. */
function amount(minor: number): number {
	return Math.max(0, finiteOr(minor));
}

/**
 * Build the mirrored in/out area geometry plus the net through-line.
 *
 * Degenerate inputs are handled explicitly rather than left to `d3`:
 * - **No points, or a zero-size box** → nothing drawable; the caller paints the zero line alone.
 * - **One point** → no area (an area needs two x positions to have extent), but the bucket is still
 *   returned as the peak so a single period is marked rather than silently dropped.
 * - **An all-zero series** → a well-defined `[0, 1]` domain so the scale never divides by zero; both
 *   areas collapse onto the zero line, and `peak` is `null` because there is no peak to name.
 */
export function buildFlow(points: FlowPoint[], width: number, height: number): FlowGeometry {
	const w = finiteOr(width);
	const h = finiteOr(height);
	const n = points.length;
	if (n === 0 || w <= 0 || h <= 0) return emptyFlow(w, h);

	const mid = h / 2;
	const usable = Math.max(1, mid - CHART_PAD);
	const maxMinor = amount(
		max(points, (p: FlowPoint) => Math.max(amount(p.inMinor), amount(p.outMinor))) ?? 0,
	);

	// A degenerate domain would make d3 return a constant mid-range value; an explicit `1` keeps the
	// zero line where it belongs and every bucket flat on it.
	const y = scaleLinear().domain([0, maxMinor > 0 ? maxMinor : 1]).range([0, usable]);
	const xScale = scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, w]);
	const xAt = (i: number): number => (n > 1 ? finiteOr(xScale(i)) : w / 2);

	const inY = (p: FlowPoint): number => mid - finiteOr(y(amount(p.inMinor)));
	const outY = (p: FlowPoint): number => mid + finiteOr(y(amount(p.outMinor)));
	// |in − out| can never exceed max(in, out), so the net line stays inside the plotted band.
	const netY = (p: FlowPoint): number => mid - finiteOr(y(amount(p.inMinor) - amount(p.outMinor)));

	let inArea = "";
	let outArea = "";
	let netLine = "";
	if (n > 1) {
		// Accessor parameters are annotated explicitly: `d3-shape` ships no type declarations, so an
		// inline arrow's parameters would land as implicit `any` under the repo's strict settings.
		const at = (_: FlowPoint, i: number): number => xAt(i);
		inArea = safePath(
			area<FlowPoint>().x(at).y0(mid).y1(inY).curve(curveMonotoneX)(points),
		);
		outArea = safePath(
			area<FlowPoint>().x(at).y0(mid).y1(outY).curve(curveMonotoneX)(points),
		);
		netLine = safePath(
			line<FlowPoint>().x(at).y(netY).curve(curveMonotoneX)(points),
		);
	}

	// A plain loop, not `forEach`: assigning to `peak` inside a closure defeats control-flow
	// narrowing and types the result `null` at the return.
	let peak: Peak | null = null;
	let best = 0;
	for (let i = 0; i < n; i++) {
		const p = points[i];
		const inMinor = amount(p.inMinor);
		const outMinor = amount(p.outMinor);
		if (inMinor > best) {
			best = inMinor;
			peak = { x: xAt(i), y: inY(p), label: p.label, value: inMinor, kind: "in" };
		}
		if (outMinor > best) {
			best = outMinor;
			peak = { x: xAt(i), y: outY(p), label: p.label, value: outMinor, kind: "out" };
		}
	}

	return {
		inArea,
		outArea,
		netLine,
		ticks: buildTicks(points.map((p) => p.label), xAt),
		peak,
		maxMinor,
		width: w,
		height: h,
	};
}
// #endregion
