import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { currencyExponent } from "../core/currency-store.ts";

/**
 * @projective/ui/display/charts — chart geometry as pure functions of a series.
 *
 * `d3-scale` / `d3-shape` are used for math only (Decision #1 / #217(m)): a scale maps a figure the
 * caller already summed onto a coordinate, and nothing is computed from coordinates back into a
 * figure. Plots are drawn in a fixed viewBox and stretched to their box, so SVG needs no measurement
 * on the server; the same path strings feed the Canvas2D tier through `Path2D`. Nothing here touches
 * the DOM, a clock or the cascade.
 */

// #region Shared
/** The area plot's viewBox; the plot stretches to its box, so only the ratios matter. */
export const CHART_VIEW = { width: 640, height: 220 } as const;

/** One y-axis tick: its value and its height as a ratio of the plot from the top. */
export interface AxisTick {
	value: number;
	ratio: number;
}

/** A finite number, or `fallback` — a `NaN` in a path blanks it in every browser. */
export function finiteOr(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback;
}

/** A path with no `NaN` / `Infinity` in it, or `""`. A missing mark is honest; a half-drawn one is not. */
export function safePath(d: string | null | undefined): string {
	if (!d) return "";
	return /NaN|Infinity/.test(d) ? "" : d;
}

/** The bucket nearest a pointer, from its x as a ratio of the plot width — the crosshair's snap. */
export function nearestIndex(ratio: number, count: number): number {
	if (count <= 1) return 0;
	return Math.min(count - 1, Math.max(0, Math.round(finiteOr(ratio) * (count - 1))));
}

/** The next focused index for a key (←/→ already mirrored for RTL), or `undefined` for other keys. */
export function stepIndex(
	current: number | null,
	key: string,
	count: number,
): number | null | undefined {
	if (count === 0) return undefined;
	const last = count - 1;
	switch (key) {
		case "ArrowRight":
			return current === null ? 0 : Math.min(last, current + 1);
		case "ArrowLeft":
			return current === null ? last : Math.max(0, current - 1);
		case "Home":
			return 0;
		case "End":
			return last;
		case "Escape":
			return null;
		default:
			return undefined;
	}
}
// #endregion

// #region Area chart
/** One series of an area chart. */
export interface AreaSeriesInput {
	values: readonly number[];
	/** `area` washes down to the baseline; `line` is a stroke only. */
	mark?: "area" | "line";
	/** Plot the series below the zero baseline (money out under money in) — one axis, two directions. */
	invert?: boolean;
}

/** One series' drawable geometry. */
export interface AreaSeriesGeometry {
	path: string;
	/** Each point's height as a ratio of the plot from the top. */
	ys: number[];
}

/** Everything an area chart draws. */
export interface AreaGeometry {
	series: AreaSeriesGeometry[];
	/** Each bucket's x as a ratio of the plot width (`0`–`1`). */
	xs: number[];
	/** The zero baseline's height as a ratio from the top. */
	zero: number;
	ticks: AxisTick[];
}

/**
 * Area / line geometry on ONE shared y-scale. With an inverted series the domain diverges around zero
 * (an empty window still gets a quarter-height lower band so the frame says "nothing moved");
 * without one, the baseline sits at the bottom. One bucket sits in the middle.
 */
export function areaGeometry(
	series: readonly AreaSeriesInput[],
	width: number = CHART_VIEW.width,
	height: number = CHART_VIEW.height,
): AreaGeometry {
	const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
	const diverging = series.some((s) => s.invert);
	const plotted = series.map((s) => s.values.map((v) => (s.invert ? -finiteOr(v) : finiteOr(v))));
	const maxUp = plotted.reduce((m, vs) => vs.reduce((a, v) => Math.max(a, v), m), 0);
	const maxDown = plotted.reduce((m, vs) => vs.reduce((a, v) => Math.max(a, -v), m), 0);
	const top = maxUp > 0 ? maxUp : maxDown > 0 ? maxDown * 0.25 : 1;
	const bottom = maxDown > 0 ? maxDown : diverging ? top * 0.25 : 0;
	const y = scaleLinear().domain([-bottom, top]).range([height, 0]).nice(4);
	const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range(
		n === 1 ? [width / 2, width / 2] : [0, width],
	);
	const xAt = (_: number, i: number) => x(i);
	const yAt = (v: number) => y(v);

	return {
		series: series.map((s, si) => {
			const vs = plotted[si];
			const shape = s.mark === "line"
				? line<number>().x(xAt).y(yAt).curve(curveMonotoneX)
				: area<number>().x(xAt).y0(y(0)).y1(yAt).curve(curveMonotoneX);
			return {
				path: vs.length > 0 ? safePath(shape(vs)) : "",
				ys: vs.map((v) => y(v) / height),
			};
		}),
		xs: Array.from({ length: n }, (_, i) => x(i) / width),
		zero: y(0) / height,
		ticks: y.ticks(4).map((value: number) => ({ value, ratio: y(value) / height })),
	};
}
// #endregion

// #region Sparkline
/** The sparkline's own coordinate space, stretched to its box. */
export const SPARK_VIEW = { width: 100, height: 32, pad: 3 } as const;

/** A sparkline's drawable geometry; empty strings mean "nothing drawable", never a fake mark. */
export interface SparkGeometry {
	line: string;
	area: string;
	/** The terminal point — the current value. */
	dot: { x: number; y: number } | null;
	/** Each point's position as ratios of the box. */
	points: { x: number; y: number }[];
}

/**
 * Sparkline geometry. Fewer than two points draws nothing (a one-point trend is not a trend); an
 * all-equal series is a flat line through the middle.
 */
export function sparkGeometry(series: readonly number[]): SparkGeometry {
	const { width, height, pad } = SPARK_VIEW;
	const values = series.map((v) => finiteOr(v));
	const n = values.length;
	if (n < 2) return { line: "", area: "", dot: null, points: [] };
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	const x = scaleLinear().domain([0, n - 1]).range([0, width]);
	const y = scaleLinear().domain([lo, hi]).range([height - pad, pad]);
	const xAt = (_: number, i: number): number => finiteOr(x(i));
	const yAt = (v: number): number => (hi > lo ? finiteOr(y(v), height / 2) : height / 2);
	return {
		line: safePath(line<number>().x(xAt).y(yAt).curve(curveMonotoneX)(values)),
		area: safePath(area<number>().x(xAt).y0(height).y1(yAt).curve(curveMonotoneX)(values)),
		dot: { x: xAt(0, n - 1), y: yAt(values[n - 1]) },
		points: values.map((v, i) => ({ x: xAt(v, i) / width, y: yAt(v) / height })),
	};
}
// #endregion

// #region Funnel
/** One funnel step's input. */
export interface FunnelStepInput {
	label: string;
	value: number;
}

/** One funnel step's geometry. */
export interface FunnelStep {
	label: string;
	value: number;
	/** Bar length as a ratio of the widest step (`0`–`1`). */
	ratio: number;
	/** This step as a share of the first, `0`–`1`; `null` when the first step is empty. */
	ofFirst: number | null;
	/** The share lost since the previous step, `0`–`1`; `null` on the first step or after an empty one. */
	dropOff: number | null;
}

/** Funnel geometry: each step against the widest one, with its share of the first and its drop-off. */
export function funnelGeometry(steps: readonly FunnelStepInput[]): FunnelStep[] {
	const values = steps.map((s) => Math.max(0, finiteOr(s.value)));
	const widest = values.reduce((m, v) => Math.max(m, v), 0);
	const first = values[0] ?? 0;
	return steps.map((s, i) => {
		const v = values[i];
		const prev = i > 0 ? values[i - 1] : null;
		return {
			label: s.label,
			value: v,
			ratio: widest > 0 ? v / widest : 0,
			ofFirst: first > 0 ? v / first : null,
			dropOff: prev !== null && prev > 0 ? Math.max(0, 1 - v / prev) : null,
		};
	});
}

/** A share (`0`–`1`) as a whole percent, `<1%` for a sliver. */
export function percentLabel(share: number | null): string {
	if (share === null || !Number.isFinite(share)) return "—";
	if (share <= 0) return "0%";
	if (share < 0.01) return "<1%";
	return `${Math.round(share * 100)}%`;
}
// #endregion

// #region Heatmap
/** How many ramp steps a heatmap cell can take, above the empty step 0. */
export const HEAT_STEPS = 5;

/**
 * Bucket a grid of values onto the ramp: `0` for zero (or less), else `1`–`5` by share of the largest
 * value. A grid with nothing in it is all `0`.
 */
export function heatSteps(values: readonly (readonly number[])[]): number[][] {
	const max = values.reduce((m, row) => row.reduce((a, v) => Math.max(a, finiteOr(v)), m), 0);
	return values.map((row) =>
		row.map((raw) => {
			const v = finiteOr(raw);
			if (v <= 0 || max <= 0) return 0;
			return Math.min(HEAT_STEPS, Math.max(1, Math.ceil((v / max) * HEAT_STEPS)));
		})
	);
}

/** The cell a 2-D key moves to (←/→ along a row, ↑/↓ across rows, Home/End to the row's ends). */
export function stepCell(
	current: { row: number; col: number } | null,
	key: string,
	rows: number,
	cols: number,
): { row: number; col: number } | null | undefined {
	if (rows === 0 || cols === 0) return undefined;
	const at = current ?? { row: 0, col: 0 };
	switch (key) {
		case "ArrowRight":
			return current === null ? at : { row: at.row, col: Math.min(cols - 1, at.col + 1) };
		case "ArrowLeft":
			return current === null ? at : { row: at.row, col: Math.max(0, at.col - 1) };
		case "ArrowDown":
			return current === null ? at : { row: Math.min(rows - 1, at.row + 1), col: at.col };
		case "ArrowUp":
			return current === null ? at : { row: Math.max(0, at.row - 1), col: at.col };
		case "Home":
			return { row: at.row, col: 0 };
		case "End":
			return { row: at.row, col: cols - 1 };
		case "Escape":
			return null;
		default:
			return undefined;
	}
}
// #endregion

// #region Renderer tier
/** Which renderer draws a chart. */
export type ChartTier = "svg" | "canvas";

/** When a chart escalates from SVG to Canvas2D (#217(m), DESIGN_SYSTEM §C.5). */
export interface ChartTierPolicy {
	/** Entities (points × series, cells, steps) above which SVG would bloat the DOM. */
	threshold: number;
	/** A measured SVG commit slower than this (ms) escalates too. */
	budgetMs: number;
}

/** The default policy: 2,000 entities, or a commit slower than half a 60 Hz frame. */
export const DEFAULT_TIER_POLICY: ChartTierPolicy = { threshold: 2000, budgetMs: 8 };

/** The tier a chart should render with, from its entity count and, once known, its measured cost. */
export function chartTier(
	entities: number,
	measuredMs: number | null = null,
	policy: ChartTierPolicy = DEFAULT_TIER_POLICY,
): ChartTier {
	if (entities > policy.threshold) return "canvas";
	if (measuredMs !== null && measuredMs > policy.budgetMs) return "canvas";
	return "svg";
}
// #endregion

// #region Axis labels
/**
 * A compact axis figure ("£12.5K", "−£1.5K") from minor units — a label for a tick the scale chose,
 * never a balance a reader acts on.
 */
export function compactMoney(minor: number, currency: string, locale = "en-GB"): string {
	const major = finiteOr(minor) / 10 ** currencyExponent(currency);
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

/** Auto-compact a count: `1,284` · `12.9K` · `4.2M`. Counts only — money arrives pre-formatted. */
export function compactCount(n: number): string {
	const value = finiteOr(n);
	if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return value.toLocaleString("en-GB");
}

/** The direction a pre-formatted delta points, read from its sign (ASCII or typographic minus). */
export type DeltaDirection = "up" | "down" | "flat";

/** Read the direction out of a delta string (`"+12%"`, `"−£240"`, `"0"`). */
export function deltaDirection(delta: string | null | undefined): DeltaDirection {
	if (!delta) return "flat";
	const trimmed = delta.trim();
	if (/^[+▲↑]/.test(trimmed)) return "up";
	if (/^[-−–▼↓]/.test(trimmed)) return "down";
	return "flat";
}
// #endregion

// #region Time axis
const DAY = 86_400_000;

/** One dated item placed on a time axis. */
export interface PlacedItem<T> {
	id: string;
	/** Its position along the axis, `0`–`1`. */
	ratio: number;
	item: T;
}

/** A time axis from `now` to the latest dated item, with week ticks. */
export interface TimeAxis<T> {
	from: number;
	to: number;
	placed: PlacedItem<T>[];
	ticks: { label: string; ratio: number }[];
}

/**
 * Places every DATED item on an axis that starts at `now` and runs to the latest of them, never
 * shorter than `minDays`, so two items a day apart do not read as a month apart. Undated items are
 * not placed — the caller lists them as "no date yet" rather than inventing one.
 */
export function timeAxis<T extends { id: string; at: string | null }>(
	items: readonly T[],
	now: number,
	minDays = 14,
	timeZone?: string,
	locale = "en-GB",
): TimeAxis<T> {
	const from = now;
	const dated = items.filter((i) => i.at !== null && Number.isFinite(Date.parse(i.at)));
	const latest = dated.reduce(
		(m, i) => Math.max(m, Date.parse(i.at as string)),
		from + minDays * DAY,
	);
	const to = Math.max(latest, from + minDays * DAY);
	const span = to - from;
	const ratioOf = (ms: number) => Math.min(1, Math.max(0, (ms - from) / span));
	const weeks = Math.max(1, Math.round(span / (7 * DAY)));
	const step = weeks <= 6 ? 7 : Math.ceil(weeks / 6) * 7;
	const ticks: { label: string; ratio: number }[] = [{ label: "Today", ratio: 0 }];
	for (let d = step; d * DAY < span; d += step) {
		ticks.push({
			label: new Date(from + d * DAY).toLocaleDateString(locale, {
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
		placed: dated.map((i) => ({ id: i.id, ratio: ratioOf(Date.parse(i.at as string)), item: i })),
		ticks,
	};
}
// #endregion
