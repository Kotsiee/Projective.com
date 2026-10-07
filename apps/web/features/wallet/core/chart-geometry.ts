import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { currencyExponent } from "@projective/types/finance";
import type { FlowPoint, ReleaseItem } from "../types/wallet-types.ts";

/**
 * chart-geometry — the analytics page's SVG geometry, as pure functions of the server's series.
 *
 * Built with `d3-scale` / `d3-shape` app-side (the wallet's charts are hand-rolled over the d3 tier,
 * never a `packages/ui` primitive — Decision #55). Everything here is GEOMETRY: a scale maps a figure
 * the server summed onto a coordinate, and nothing is computed from the coordinates back into a figure.
 * The SVG is drawn in a fixed viewBox and stretched to its box (`preserveAspectRatio="none"` +
 * `vector-effect: non-scaling-stroke`), so the chart needs no measurement to render on the server; the
 * axis labels are HTML positioned by the same ratios, so text is never stretched with the plot.
 */

// #region Cash flow
/** The plot's viewBox; the SVG stretches to its box, so only the ratios matter. */
export const FLOW_VIEW = { width: 640, height: 220 } as const;

/** One y-axis tick: its value (minor units) and its height as a ratio of the plot from the top. */
export interface AxisTick {
	value: number;
	ratio: number;
}

/** Everything the cash-flow chart draws. */
export interface FlowGeometry {
	/** Money in, as an area rising from the zero baseline. */
	inPath: string;
	/** Money out, as an area falling below it — one axis, one unit, two directions. */
	outPath: string;
	/** Net (in − out) per bucket, as a 2px line. */
	netPath: string;
	/** Each bucket's x as a ratio of the plot width (`0`–`1`). */
	xs: number[];
	/** Each bucket's in / out / net heights as ratios of the plot from the top. */
	yIn: number[];
	yOut: number[];
	yNet: number[];
	/** The zero baseline's height as a ratio from the top. */
	zero: number;
	ticks: AxisTick[];
}

/**
 * The diverging in/out area geometry with the net trend line, on ONE shared y-scale (money in above
 * zero, money out below, net across both) — never a second axis. An empty window still yields a
 * baseline and a symmetric unit domain, so the frame is drawn and says "nothing moved".
 */
export function flowGeometry(
	points: readonly FlowPoint[],
	width: number = FLOW_VIEW.width,
	height: number = FLOW_VIEW.height,
): FlowGeometry {
	const n = points.length;
	const maxIn = points.reduce((m, p) => Math.max(m, p.inMinor, p.netMinor), 0);
	const maxOut = points.reduce((m, p) => Math.max(m, p.outMinor, -p.netMinor), 0);
	const top = maxIn > 0 ? maxIn : maxOut > 0 ? maxOut * 0.25 : 1;
	const bottom = maxOut > 0 ? maxOut : top * 0.25;
	const y = scaleLinear().domain([-bottom, top]).range([height, 0]).nice(4);
	const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range(
		n === 1 ? [width / 2, width / 2] : [0, width],
	);
	const xAt = (_: FlowPoint, i: number) => x(i);

	const inArea = area<FlowPoint>().x(xAt).y0(y(0)).y1((p: FlowPoint) => y(p.inMinor)).curve(
		curveMonotoneX,
	);
	const outArea = area<FlowPoint>().x(xAt).y0(y(0)).y1((p: FlowPoint) => y(-p.outMinor)).curve(
		curveMonotoneX,
	);
	const netLine = line<FlowPoint>().x(xAt).y((p: FlowPoint) => y(p.netMinor)).curve(curveMonotoneX);
	const series = [...points];

	return {
		inPath: n > 0 ? inArea(series) ?? "" : "",
		outPath: n > 0 ? outArea(series) ?? "" : "",
		netPath: n > 0 ? netLine(series) ?? "" : "",
		xs: points.map((_, i) => x(i) / width),
		yIn: points.map((p) => y(p.inMinor) / height),
		yOut: points.map((p) => y(-p.outMinor) / height),
		yNet: points.map((p) => y(p.netMinor) / height),
		zero: y(0) / height,
		ticks: y.ticks(4).map((value: number) => ({ value, ratio: y(value) / height })),
	};
}

/** The bucket nearest a pointer, from its x as a ratio of the plot width — the crosshair's snap. */
export function nearestIndex(ratio: number, count: number): number {
	if (count <= 1) return 0;
	return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
}

/**
 * A compact axis figure ("£12K", "−£1.5K") from minor units — an axis label for a tick the scale chose,
 * never a balance; every figure a reader acts on is the server's own `MoneyView`.
 */
export function compactMoney(minor: number, currency: string, locale = "en-GB"): string {
	const major = minor / 10 ** currencyExponent(currency);
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: currency.toUpperCase(),
			notation: "compact",
			maximumSignificantDigits: 3,
		}).format(major).replace("-", "−");
	} catch {
		return major.toLocaleString(locale);
	}
}
// #endregion

// #region Release schedule
const DAY = 86_400_000;

/** One dated release placed on the schedule's axis. */
export interface PlacedRelease {
	id: string;
	/** Its position along the axis, `0`–`1`. */
	ratio: number;
	state: ReleaseItem["state"];
}

/** The schedule's axis: today to the latest dated release (a fortnight at least), with week ticks. */
export interface ReleaseAxis {
	from: number;
	to: number;
	placed: PlacedRelease[];
	ticks: { label: string; ratio: number }[];
}

/**
 * Places every DATED release on a time axis that starts today and runs to the latest of them, never
 * shorter than `minDays` so two releases a day apart do not read as a month apart. Undated items (escrow
 * awaiting approval) are not placed — the schedule lists them as "no date yet" rather than inventing one.
 */
export function releaseAxis(
	items: readonly ReleaseItem[],
	now: number,
	minDays = 14,
	timeZone?: string,
): ReleaseAxis {
	const from = now;
	const dated = items.filter((i) => i.at !== null && Number.isFinite(Date.parse(i.at)));
	const latest = dated.reduce((m, i) => Math.max(m, Date.parse(i.at!)), from + minDays * DAY);
	const to = Math.max(latest, from + minDays * DAY);
	const span = to - from;
	const ratioOf = (ms: number) => Math.min(1, Math.max(0, (ms - from) / span));
	const weeks = Math.max(1, Math.round(span / (7 * DAY)));
	const step = weeks <= 6 ? 7 : Math.ceil(weeks / 6) * 7;
	const ticks: { label: string; ratio: number }[] = [{ label: "Today", ratio: 0 }];
	for (let d = step; d * DAY < span; d += step) {
		ticks.push({
			label: new Date(from + d * DAY).toLocaleDateString("en-GB", {
				day: "numeric",
				month: "short",
				timeZone,
			}),
			ratio: ratioOf(from + d * DAY),
		});
	}
	return {
		from,
		to,
		placed: dated.map((i) => ({ id: i.id, ratio: ratioOf(Date.parse(i.at!)), state: i.state })),
		ticks,
	};
}
// #endregion
