import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/charts.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../fields/hooks/useId.ts";
import {
	type ChartTierPolicy,
	DEFAULT_TIER_POLICY,
	nearestIndex,
	SPARK_VIEW,
	sparkGeometry,
	stepIndex,
} from "./geometry.ts";
import {
	type ChartBox,
	type ChartColour,
	useChartCanvas,
	useChartTier,
	viewPath,
} from "./useChart.ts";

/** Props for {@link Sparkline}. */
export interface SparklineProps {
	values: readonly number[];
	/**
	 * Decoration beside a figure that already states the fact in text (a stat tile): `aria-hidden`,
	 * not focusable, no table. Default `false`.
	 */
	decorative?: boolean;
	/** The figure's caption; required unless decorative. */
	caption?: string;
	captionHidden?: boolean;
	/** One label per point, for the readout and the hidden table. */
	labels?: readonly string[];
	formatValue?: (value: number) => ComponentChildren;
	tierPolicy?: ChartTierPolicy;
	class?: string;
}

/**
 * Sparkline — a small accent trend line with a wash beneath it and a dot on the current value.
 *
 * `preserveAspectRatio="none"` stretches it to its box and `vector-effect` keeps the stroke true.
 * Decorative inside a stat tile; standalone it meets the chart contract — figure, caption, hidden
 * table, and a focusable plot whose ←/→ move a point announced through a polite readout. Very long
 * series move to the Canvas2D tier. Nothing tweens.
 */
export function Sparkline(props: SparklineProps): JSX.Element | null {
	const { values } = props;
	const geo = sparkGeometry(values);
	const active = useSignal<number | null>(null);
	const captionId = useId(undefined, "ui-chart-caption");
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLSpanElement>(null);
	const tier = useChartTier(values.length, props.tierPolicy ?? DEFAULT_TIER_POLICY);
	const count = geo.points.length;

	useChartCanvas({
		canvasRef,
		probeRef,
		enabled: tier === "canvas" && count > 0,
		deps: [geo.line],
		paint: (ctx: CanvasRenderingContext2D, box: ChartBox, colour: ChartColour) => {
			ctx.fillStyle = colour("color-mix(in srgb, var(--ui-chart-ca) var(--tint), transparent)");
			ctx.fill(viewPath(geo.area, SPARK_VIEW.width, SPARK_VIEW.height, box));
			ctx.strokeStyle = colour("var(--ui-chart-ca)");
			ctx.lineWidth = 1.5;
			ctx.lineJoin = "round";
			ctx.lineCap = "round";
			ctx.stroke(viewPath(geo.line, SPARK_VIEW.width, SPARK_VIEW.height, box));
		},
	});

	if (count === 0) return null;

	const marks = tier === "svg"
		? (
			<svg
				class="ui-chart__spark"
				viewBox={`0 0 ${SPARK_VIEW.width} ${SPARK_VIEW.height}`}
				preserveAspectRatio="none"
				aria-hidden="true"
				focusable="false"
			>
				{geo.area && <path class="ui-chart__spark-area" d={geo.area} />}
				<path class="ui-chart__spark-line" d={geo.line} vector-effect="non-scaling-stroke" />
			</svg>
		)
		: <canvas ref={canvasRef} class="ui-chart__canvas" aria-hidden="true" />;

	const end = geo.points[count - 1];
	const dot = (i: number) => (
		<span
			class="ui-chart__spark-dot"
			aria-hidden="true"
			style={styleVars({ "--ui-chart-x": geo.points[i].x, "--ui-chart-y": geo.points[i].y })}
		/>
	);

	if (props.decorative) {
		return (
			<span
				class={cx("ui-chart", "ui-chart--spark", props.class)}
				aria-hidden="true"
				data-tier={tier}
			>
				<span ref={probeRef} class="ui-chart__probe" />
				<span class="ui-chart__spark-box">
					{marks}
					{end && dot(count - 1)}
				</span>
			</span>
		);
	}

	const at = active.value;
	const format = props.formatValue ?? ((v: number) => v.toLocaleString());
	const labelOf = (i: number) => props.labels?.[i] ?? `Point ${i + 1}`;
	const caption = props.caption ?? "Trend";

	return (
		<figure
			class={cx("ui-chart", "ui-chart--spark", props.class)}
			role="group"
			aria-labelledby={captionId}
			data-tier={tier}
		>
			<figcaption
				id={captionId}
				class={cx("ui-chart__caption", props.captionHidden && "ui-visually-hidden")}
			>
				{caption}
			</figcaption>
			<span ref={probeRef} class="ui-chart__probe" aria-hidden="true" />
			<div
				class="ui-chart__spark-box ui-chart__plot"
				role="group"
				aria-roledescription="chart"
				aria-label={`${caption}. Use the arrow keys to read each point.`}
				tabIndex={0}
				onKeyDown={(e) => {
					const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
					const key = rtl && e.key === "ArrowLeft"
						? "ArrowRight"
						: rtl && e.key === "ArrowRight"
						? "ArrowLeft"
						: e.key;
					const next = stepIndex(at, key, count);
					if (next === undefined) return;
					e.preventDefault();
					active.value = next;
				}}
				onPointerMove={(e) => {
					const box = e.currentTarget.getBoundingClientRect();
					if (box.width <= 0) return;
					const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
					const ratio = (e.clientX - box.left) / box.width;
					active.value = nearestIndex(rtl ? 1 - ratio : ratio, count);
				}}
				onPointerLeave={() => (active.value = null)}
				onBlur={() => (active.value = null)}
			>
				{marks}
				{dot(at ?? count - 1)}
			</div>
			<p class="ui-chart__readout" aria-live="polite">
				{at !== null
					? (
						<>
							<span class="ui-chart__when">{labelOf(at)}</span>
							<span class="ui-chart__pair">{format(values[at] ?? 0)}</span>
						</>
					)
					: null}
			</p>
			<div class="ui-visually-hidden">
				<table>
					<caption>{caption}</caption>
					<thead>
						<tr>
							<th scope="col">Point</th>
							<th scope="col">Value</th>
						</tr>
					</thead>
					<tbody>
						{values.map((v, i) => (
							<tr key={i}>
								<th scope="row">{labelOf(i)}</th>
								<td>{format(v)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	);
}
