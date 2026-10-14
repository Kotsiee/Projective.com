import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/charts.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../fields/hooks/useId.ts";
import {
	areaGeometry,
	CHART_VIEW,
	type ChartTierPolicy,
	DEFAULT_TIER_POLICY,
	nearestIndex,
	stepIndex,
} from "./geometry.ts";
import {
	type ChartBox,
	type ChartColour,
	useChartCanvas,
	useChartTier,
	viewPath,
} from "./useChart.ts";

/** One series of an {@link AreaChart}. */
export interface AreaChartSeries {
	id: string;
	/** The legend and table-column name ("Money in"). */
	label: string;
	/** The readout's name beside a value ("in"); defaults to `label`. */
	shortLabel?: string;
	values: readonly number[];
	/** `area` (default) washes to the baseline; `line` is a 2px stroke. */
	mark?: "area" | "line";
	/** Plot below the zero baseline — one axis, two directions. */
	invert?: boolean;
}

/** Props for {@link AreaChart}. */
export interface AreaChartProps {
	/** The figure's caption — its accessible name and the hidden table's caption. */
	caption: string;
	/** Keep the caption for assistive tech only, when a region heading already says it. */
	captionHidden?: boolean;
	/** One label per bucket, in order. */
	labels: readonly string[];
	/** The row header and readout name of a bucket ("From 5 Oct"); defaults to its label. */
	bucketName?: (label: string, index: number) => string;
	/** The hidden table's first column header (default "Period"). */
	bucketHeader?: string;
	/** Series colours come from `--ui-chart-1…4`, in series order. */
	series: readonly AreaChartSeries[];
	/** A value as the reader sees it in the readout and the table. */
	formatValue: (value: number, series: AreaChartSeries) => ComponentChildren;
	/** A y-axis tick label (default: the number). */
	formatTick?: (value: number) => string;
	/** The readout's resting hint. */
	hint?: string;
	tierPolicy?: ChartTierPolicy;
	class?: string;
}

/**
 * AreaChart — series over time as washed areas and lines on one shared y-axis, with a crosshair.
 *
 * SVG by default, in a fixed viewBox stretched to its box; the axis labels, gridlines, crosshair and
 * dots are HTML placed by the same ratios, so text is never stretched. Above the entity threshold, or
 * when measured updates overrun the frame budget, the marks move to a Canvas2D layer painted from the
 * same path strings, with colours resolved through the theme-bridge.
 *
 * The figure is a `role="group"` with a caption and a visually hidden table of every bucket. The plot
 * is one focusable group: ←/→ (mirrored under RTL), Home and End move the crosshair and a polite
 * readout names every series there; a pointer does the same by the nearest bucket. Nothing tweens.
 */
export function AreaChart(props: AreaChartProps): JSX.Element {
	const { labels, series, formatValue } = props;
	const active = useSignal<number | null>(null);
	const captionId = useId(undefined, "ui-chart-caption");
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLSpanElement>(null);
	const geo = areaGeometry(series);
	const count = geo.xs.length;
	const tier = useChartTier(
		count * Math.max(1, series.length),
		props.tierPolicy ?? DEFAULT_TIER_POLICY,
	);
	const at = active.value;
	const order = series.map((s, i) => ({ s, i })).sort((a, b) =>
		(a.s.mark === "line" ? 0 : 1) - (b.s.mark === "line" ? 0 : 1)
	);
	const nameOf = (i: number) => props.bucketName?.(labels[i] ?? "", i) ?? labels[i] ?? "";
	const tick = props.formatTick ?? ((v: number) => v.toLocaleString());

	useChartCanvas({
		canvasRef,
		probeRef,
		enabled: tier === "canvas",
		deps: [geo.series.map((s) => s.path).join("|")],
		paint: (ctx: CanvasRenderingContext2D, box: ChartBox, colour: ChartColour) => {
			for (const { s, i } of order) {
				const path = viewPath(geo.series[i].path, CHART_VIEW.width, CHART_VIEW.height, box);
				const ink = colour(`var(--ui-chart-c${(i % 4) + 1})`);
				if (s.mark !== "line") {
					ctx.fillStyle = colour(
						`color-mix(in srgb, var(--ui-chart-c${(i % 4) + 1}) var(--tint), transparent)`,
					);
					ctx.fill(path);
				}
				ctx.strokeStyle = ink;
				ctx.lineWidth = 2;
				ctx.lineJoin = "round";
				ctx.lineCap = "round";
				ctx.stroke(path);
			}
		},
	});

	const onKeyDown = (e: KeyboardEvent) => {
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const key = rtl && e.key === "ArrowLeft"
			? "ArrowRight"
			: rtl && e.key === "ArrowRight"
			? "ArrowLeft"
			: e.key;
		const next = stepIndex(at, key, count);
		if (next === undefined) return;
		e.preventDefault();
		active.value = next;
	};

	const onPoint = (e: PointerEvent) => {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (box.width <= 0) return;
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const ratio = (e.clientX - box.left) / box.width;
		active.value = nearestIndex(rtl ? 1 - ratio : ratio, count);
	};

	return (
		<figure
			class={cx("ui-chart", "ui-chart--area", props.class)}
			role="group"
			aria-labelledby={captionId}
			data-tier={tier}
		>
			<figcaption
				id={captionId}
				class={cx("ui-chart__caption", props.captionHidden && "ui-visually-hidden")}
			>
				{props.caption}
			</figcaption>
			<span ref={probeRef} class="ui-chart__probe" aria-hidden="true" />
			<div class="ui-chart__frame">
				<div class="ui-chart__yaxis" aria-hidden="true">
					{geo.ticks.map((t) => (
						<span
							key={t.value}
							class="ui-chart__ytick"
							style={styleVars({ "--ui-chart-y": t.ratio })}
						>
							{t.value === 0 ? "0" : tick(t.value)}
						</span>
					))}
				</div>
				<div
					class="ui-chart__plot"
					role="group"
					aria-roledescription="chart"
					aria-label={`${props.caption}. Use the arrow keys to read each point.`}
					tabIndex={0}
					onKeyDown={onKeyDown}
					onPointerMove={onPoint}
					onPointerDown={onPoint}
					onPointerLeave={() => (active.value = null)}
					onBlur={() => (active.value = null)}
				>
					<div class="ui-chart__grid" aria-hidden="true">
						{geo.ticks.map((t) => (
							<span
								key={t.value}
								class="ui-chart__gridline"
								data-zero={t.value === 0 ? "true" : undefined}
								style={styleVars({ "--ui-chart-y": t.ratio })}
							/>
						))}
					</div>
					{tier === "svg"
						? (
							<svg
								class="ui-chart__svg"
								viewBox={`0 0 ${CHART_VIEW.width} ${CHART_VIEW.height}`}
								preserveAspectRatio="none"
								aria-hidden="true"
								focusable="false"
							>
								{order.map(({ s, i }) => (
									<path
										key={s.id}
										class={s.mark === "line" ? "ui-chart__line" : "ui-chart__area"}
										data-series={(i % 4) + 1}
										d={geo.series[i].path}
									/>
								))}
							</svg>
						)
						: <canvas ref={canvasRef} class="ui-chart__canvas" aria-hidden="true" />}
					{at !== null && at < count && (
						<div
							class="ui-chart__cross"
							aria-hidden="true"
							style={styleVars({ "--ui-chart-x": geo.xs[at] })}
						>
							{series.map((s, i) => (
								<span
									key={s.id}
									class="ui-chart__dot"
									data-series={(i % 4) + 1}
									style={styleVars({ "--ui-chart-y": geo.series[i].ys[at] })}
								/>
							))}
						</div>
					)}
				</div>
				<div class="ui-chart__xaxis" aria-hidden="true">
					<span>{labels[0] ?? ""}</span>
					{count > 2 && <span>{labels[Math.floor((count - 1) / 2)]}</span>}
					<span>{count > 1 ? labels[count - 1] : ""}</span>
				</div>
			</div>

			<div class="ui-chart__foot">
				<ul class="ui-chart__legend" aria-hidden="true">
					{series.map((s, i) => (
						<li
							key={s.id}
							class="ui-chart__key"
							data-series={(i % 4) + 1}
							data-mark={s.mark ?? "area"}
						>
							{s.label}
						</li>
					))}
				</ul>
				<p class="ui-chart__readout" aria-live="polite">
					{at !== null && at < count
						? (
							<>
								<span class="ui-chart__when">{nameOf(at)}</span>
								{series.map((s, i) => (
									<span key={s.id} class="ui-chart__pair">
										<span class="ui-chart__swatch" data-series={(i % 4) + 1} aria-hidden="true" />
										{formatValue(s.values[at] ?? 0, s)}
										<span class="ui-chart__name">{s.shortLabel ?? s.label}</span>
									</span>
								))}
							</>
						)
						: (
							<span class="ui-chart__hint">
								{props.hint ?? "Point at the chart, or focus it and use the arrow keys"}
							</span>
						)}
				</p>
			</div>

			<div class="ui-visually-hidden">
				<table>
					<caption>{props.caption}</caption>
					<thead>
						<tr>
							<th scope="col">{props.bucketHeader ?? "Period"}</th>
							{series.map((s) => <th key={s.id} scope="col">{s.label}</th>)}
						</tr>
					</thead>
					<tbody>
						{labels.map((_, r) => (
							<tr key={r}>
								<th scope="row">{nameOf(r)}</th>
								{series.map((s) => <td key={s.id}>{formatValue(s.values[r] ?? 0, s)}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	);
}
