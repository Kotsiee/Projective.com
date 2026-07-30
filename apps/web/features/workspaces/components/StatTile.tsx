import type { ComponentChildren, JSX, VNode } from "preact";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { cx } from "@ui/core/cx.ts";

/**
 * StatTile — the house dataviz stat-tile, in the workspace console's register.
 *
 * The contract is the one every other surface on the platform already follows (the catalogue KPI strip,
 * the wallet's intelligence band): a **tracked micro-label**, an **auto-compacted value in tabular
 * figures**, a **signed delta** whose direction is carried by tone as well as by its sign, and a small
 * **accent sparkline**. Text wears text tokens; the only chroma in a tile is the delta and the spark, so
 * a row of five tiles reads as one instrument panel rather than five competing badges.
 *
 * ### The tile never computes anything it displays
 * `value` and `delta` arrive as strings. Money strings are the server's `MoneyView.display` verbatim
 * (root CLAUDE.md §12 — the client never totals, splits, converts or fee-adjusts); counts are compacted
 * through {@link compactCount}, which is a pure presentation of a number the server already counted.
 * The tile's only arithmetic is the sparkline's own geometry, which is a mapping of the series into
 * pixels and carries no new fact.
 *
 * ### Why the sparkline is built with `d3-scale`/`d3-shape` here and not in `packages/ui`
 * Decision #1 tiers the chart engine: D3 owns scales and geometry, and a low-density mark is
 * hand-rolled inline SVG. `packages/ui` keeps a no-dependency portability contract, so — exactly as the
 * wallet's chart engine does — the geometry lives **app-side** in the feature that needs it. Nothing
 * here touches the DOM, reads a clock or measures an element, so SSR and the hydrated island produce
 * byte-identical path strings and the mark never flickers through a re-layout on hydration.
 *
 * ### The mark is static on purpose
 * A sparkline encodes a series. Nothing about it is transitioned or keyframed (root CLAUDE.md §11): a
 * frozen animation clock in a backgrounded tab must never be able to leave a chart drawn at zero.
 */

// #region Geometry guards
/** The sparkline's own coordinate space. Scaled to the tile by `preserveAspectRatio="none"`. */
const SPARK_W = 100;
const SPARK_H = 32;

/** Block-axis breathing room so a peak or a trough never touches the plot edge. */
const SPARK_PAD = 3;

/**
 * Coerce a value to a finite number. Guards every arithmetic entry point: a `null` that survived a
 * transport boundary, or an `Infinity` from a degenerate ratio, must become a drawable `0` rather than
 * propagate into a path string.
 */
function finiteOr(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback;
}

/**
 * The last line of defence before a path reaches the DOM. A single `NaN` in a `d` attribute silently
 * blanks a path in every browser, so an unusable path is dropped entirely — a missing mark is honest, a
 * half-drawn one is not.
 */
function safePath(d: string | null | undefined): string {
	if (!d) return "";
	return /NaN|Infinity/.test(d) ? "" : d;
}
// #endregion

// #region Sparkline geometry
/** One point of the series, carried as an object so the `d3-shape` accessors stay explicit. */
interface SparkPoint {
	i: number;
	v: number;
}

/** Everything the sparkline needs to paint. Empty strings mean "nothing drawable", never a fake mark. */
interface SparkGeometry {
	/** The through-line. */
	line: string;
	/** The filled area beneath it. */
	area: string;
	/** The terminal point — the current value, the one a reader actually looks for. */
	dot: { x: number; y: number } | null;
}

/**
 * Build the sparkline's geometry.
 *
 * Degenerate inputs are handled explicitly rather than left to `d3`:
 *   - **Fewer than two points** → nothing drawable. A one-point "trend" is not a trend, and drawing a
 *     dot alone would imply a series that does not exist.
 *   - **An all-equal series** (including all-zero) → a flat line through the vertical middle. `d3`'s
 *     linear scale over a zero-width domain returns a constant from the middle of its range, which
 *     happens to be right here, but the case is pinned explicitly so the answer cannot change under it.
 */
function buildSpark(series: readonly number[]): SparkGeometry {
	const points: SparkPoint[] = series.map((v, i) => ({ i, v: finiteOr(v) }));
	const n = points.length;
	if (n < 2) return { line: "", area: "", dot: null };

	const values = points.map((p) => p.v);
	const lo = Math.min(...values);
	const hi = Math.max(...values);

	const x = scaleLinear().domain([0, n - 1]).range([0, SPARK_W]);
	const y = scaleLinear().domain([lo, hi]).range([SPARK_H - SPARK_PAD, SPARK_PAD]);
	const xAt = (i: number): number => finiteOr(x(i));
	const yAt = (v: number): number => hi > lo ? finiteOr(y(v), SPARK_H / 2) : SPARK_H / 2;

	// Accessor parameters are annotated explicitly: an inline arrow's parameters would otherwise land
	// as implicit `any` under the repo's strict settings.
	const at = (p: SparkPoint): number => xAt(p.i);
	const to = (p: SparkPoint): number => yAt(p.v);

	return {
		line: safePath(line<SparkPoint>().x(at).y(to).curve(curveMonotoneX)(points)),
		area: safePath(area<SparkPoint>().x(at).y0(SPARK_H).y1(to).curve(curveMonotoneX)(points)),
		dot: { x: xAt(n - 1), y: yAt(points[n - 1].v) },
	};
}
// #endregion

// #region Value formatting
/**
 * Auto-compact a count: `1,284` · `12.9K` · `4.2M`.
 *
 * Counts only. A money figure is never routed through here — it arrives pre-formatted from the server,
 * because compacting a currency amount client-side would mean choosing a rounding the server did not.
 */
export function compactCount(n: number): string {
	const value = finiteOr(n);
	if (Math.abs(value) >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	}
	if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return value.toLocaleString("en-GB");
}

/** The direction a tile's delta points, driving `data-dir` and therefore its tone. */
export type DeltaDirection = "up" | "down" | "flat";

/**
 * Read the direction out of a pre-formatted delta string (`"+12%"`, `"−£240"`, `"0"`).
 *
 * The server sends the delta already written, so the tile reads its SIGN rather than re-deriving the
 * value. Both the ASCII hyphen and the typographic minus are recognised, because a formatter that
 * respects British typography emits the latter and a tile that mistook it for "flat" would render a
 * fall as no change at all.
 */
export function deltaDirection(delta: string | null | undefined): DeltaDirection {
	if (!delta) return "flat";
	const trimmed = delta.trim();
	if (/^[+▲↑]/.test(trimmed)) return "up";
	if (/^[-−–▼↓]/.test(trimmed)) return "down";
	return "flat";
}
// #endregion

// #region Tile row
export interface StatTileRowProps {
	/** Accessible name for the group — a row of tiles is one instrument, not five orphans. */
	label: string;
	children: ComponentChildren;
	class?: string;
}

/**
 * The tile row. A responsive fill grid, so a kind that shows three tiles and one that shows five both
 * use the full width of the content region — there is no `max-inline-size` anywhere on this surface
 * outside running text and form fields.
 */
export function StatTileRow(props: StatTileRowProps): JSX.Element {
	return (
		<div class={cx("wsp-tiles", props.class)} role="group" aria-label={props.label}>
			{props.children}
		</div>
	);
}
// #endregion

// #region Tile
export interface StatTileProps {
	/** The tracked micro-label. Sentence case; the stylesheet upper-cases it. */
	label: string;
	/** The figure, already final: a server `MoneyView.display`, or a {@link compactCount} of a count. */
	value: string;
	/** A pre-formatted signed delta (`"+12%"`). Direction is read from its sign, never recomputed. */
	delta?: string | null;
	/** A short qualifier under the figure — shown only when there is no sparkline to show instead. */
	caption?: string;
	/** A 0–1 (or any-scale) series for the accent sparkline. Fewer than two points draws nothing. */
	trend?: readonly number[];
	/** A small leading glyph inside the figure, for a tile whose unit is a symbol rather than a word. */
	icon?: VNode;
	/**
	 * Spoken form of the figure, when the printed one reads badly aloud (a compacted `12.9K`). The
	 * printed value is then hidden from assistive tech so the number is announced once, not twice.
	 */
	srValue?: string;
}

/**
 * One stat tile.
 *
 * A tile is separated from its neighbour by a single hairline on one edge and by spacing — never by a
 * border box or a shadow (§B.4). On a phone the row stacks and the stylesheet flips that hairline from
 * the inline axis to the block axis, so the separator follows the layout instead of disappearing.
 */
export function StatTile(props: StatTileProps): JSX.Element {
	const { label, value, delta, caption, trend, icon, srValue } = props;
	const dir = deltaDirection(delta);
	const spark = trend && trend.length > 1 ? buildSpark(trend) : null;

	return (
		<div class="wsp-tile">
			<span class="wsp-tile__label">{label}</span>
			<div class="wsp-tile__row">
				<span class="wsp-tile__value" aria-hidden={srValue ? "true" : undefined}>
					{icon && <span class="wsp-tile__vicon">{icon}</span>}
					{value}
				</span>
				{srValue && <span class="ui-visually-hidden">{srValue}</span>}
				{delta && <span class="wsp-tile__delta" data-dir={dir}>{delta}</span>}
			</div>
			{spark
				? <Sparkline geometry={spark} />
				: caption
				? <p class="wsp-tile__caption">{caption}</p>
				: null}
		</div>
	);
}
// #endregion

// #region Sparkline
/**
 * The accent mark.
 *
 * `preserveAspectRatio="none"` lets the series fill the tile's full inline size at a fixed block size,
 * and `vector-effect="non-scaling-stroke"` keeps the line's weight true under that non-uniform scale —
 * without it a wide tile would draw a visibly heavier line than a narrow one for the same data.
 *
 * `aria-hidden`: the sparkline is decoration over a figure and a delta that already state the fact in
 * text. There is nothing here for a screen reader to gain and a path element it cannot describe.
 */
function Sparkline({ geometry }: { geometry: SparkGeometry }): JSX.Element | null {
	if (!geometry.line) return null;
	return (
		<svg
			class="wsp-tile__spark"
			viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
			preserveAspectRatio="none"
			aria-hidden="true"
			focusable="false"
		>
			{geometry.area && <path class="wsp-tile__spark-area" d={geometry.area} />}
			<path
				class="wsp-tile__spark-line"
				d={geometry.line}
				vector-effect="non-scaling-stroke"
			/>
			{geometry.dot && (
				<circle class="wsp-tile__spark-dot" cx={geometry.dot.x} cy={geometry.dot.y} r="2.2" />
			)}
		</svg>
	);
}
// #endregion
