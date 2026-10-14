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
	funnelGeometry,
	type FunnelStepInput,
	percentLabel,
	stepIndex,
} from "./geometry.ts";
import { type ChartBox, type ChartColour, useChartCanvas, useChartTier } from "./useChart.ts";

/** The SVG units one step's row takes; the bar fills the middle of it. */
const ROW = 10;
const BAR_INSET = 2;

/** Props for {@link FunnelChart}. */
export interface FunnelChartProps {
	caption: string;
	captionHidden?: boolean;
	/** The steps in order, widest first (impressions → views → checkout → orders). */
	steps: readonly FunnelStepInput[];
	/** A step's value as the reader sees it (default: the number). */
	formatValue?: (value: number) => ComponentChildren;
	tierPolicy?: ChartTierPolicy;
	class?: string;
}

/**
 * FunnelChart — ordered steps as bars against the widest one, each with its share of the first step
 * and its drop-off from the one before, as meta text.
 *
 * Labels and figures are HTML rows; the bars are one SVG stretched over the same rows (Canvas2D above
 * the entity threshold). The figure carries a caption and a hidden table; the plot is focusable, and
 * ←/→ (or ↑/↓) move between steps, each announced with its value, share and drop-off.
 */
export function FunnelChart(props: FunnelChartProps): JSX.Element {
	const steps = funnelGeometry(props.steps);
	const n = steps.length;
	const active = useSignal<number | null>(null);
	const captionId = useId(undefined, "ui-chart-caption");
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLSpanElement>(null);
	const tier = useChartTier(n, props.tierPolicy ?? DEFAULT_TIER_POLICY);
	const format = props.formatValue ?? ((v: number) => v.toLocaleString());
	const at = active.value;
	const first = steps[0]?.label ?? "";

	useChartCanvas({
		canvasRef,
		probeRef,
		enabled: tier === "canvas",
		deps: [steps.map((s) => s.ratio).join("|"), at],
		paint: (ctx: CanvasRenderingContext2D, box: ChartBox, colour: ChartColour) => {
			const rowH = box.height / Math.max(1, n);
			const inset = rowH * (BAR_INSET / ROW);
			steps.forEach((s, i) => {
				const w = s.ratio * box.width;
				ctx.fillStyle = colour(
					i === at
						? "var(--ui-chart-c1)"
						: "color-mix(in srgb, var(--ui-chart-c1) var(--tint-heavy), var(--surface-1))",
				);
				ctx.fillRect(box.rtl ? box.width - w : 0, i * rowH + inset, w, rowH - inset * 2);
			});
		},
	});

	const announce = (i: number) => {
		const s = steps[i];
		const parts = [s.label, s.value.toLocaleString()];
		if (i > 0) {
			parts.push(`${percentLabel(s.ofFirst)} of ${first}`, `${percentLabel(s.dropOff)} drop-off`);
		}
		return parts.join(" · ");
	};

	return (
		<figure
			class={cx("ui-chart", "ui-chart--funnel", props.class)}
			role="group"
			aria-labelledby={captionId}
			data-tier={tier}
			style={styleVars({ "--ui-chart-rows": n })}
		>
			<figcaption
				id={captionId}
				class={cx("ui-chart__caption", props.captionHidden && "ui-visually-hidden")}
			>
				{props.caption}
			</figcaption>
			<span ref={probeRef} class="ui-chart__probe" aria-hidden="true" />
			<div class="ui-chart__funnel">
				<ol class="ui-chart__steps" aria-hidden="true">
					{steps.map((s, i) => (
						<li key={s.label} class="ui-chart__step" data-active={i === at ? "true" : undefined}>
							{s.label}
						</li>
					))}
				</ol>
				<div
					class="ui-chart__plot"
					role="group"
					aria-roledescription="chart"
					aria-label={`${props.caption}. Use the arrow keys to read each step.`}
					tabIndex={0}
					onKeyDown={(e) => {
						const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
						const map: Record<string, string> = {
							ArrowDown: "ArrowRight",
							ArrowUp: "ArrowLeft",
							ArrowRight: rtl ? "ArrowLeft" : "ArrowRight",
							ArrowLeft: rtl ? "ArrowRight" : "ArrowLeft",
						};
						const next = stepIndex(at, map[e.key] ?? e.key, n);
						if (next === undefined) return;
						e.preventDefault();
						active.value = next;
					}}
					onPointerMove={(e) => {
						const box = e.currentTarget.getBoundingClientRect();
						if (box.height <= 0 || n === 0) return;
						active.value = Math.min(
							n - 1,
							Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * n)),
						);
					}}
					onPointerLeave={() => (active.value = null)}
					onBlur={() => (active.value = null)}
				>
					{tier === "svg"
						? (
							<svg
								class="ui-chart__svg"
								viewBox={`0 0 100 ${Math.max(1, n) * ROW}`}
								preserveAspectRatio="none"
								aria-hidden="true"
								focusable="false"
							>
								{steps.map((s, i) => (
									<rect
										key={s.label}
										class="ui-chart__bar"
										data-active={i === at ? "true" : undefined}
										x={0}
										y={i * ROW + BAR_INSET}
										width={s.ratio * 100}
										height={ROW - BAR_INSET * 2}
									/>
								))}
							</svg>
						)
						: <canvas ref={canvasRef} class="ui-chart__canvas" aria-hidden="true" />}
				</div>
				<ol class="ui-chart__figures" aria-hidden="true">
					{steps.map((s, i) => (
						<li key={s.label} class="ui-chart__figure" data-active={i === at ? "true" : undefined}>
							<span class="ui-chart__value">{format(s.value)}</span>
							{i > 0 && (
								<span class="ui-chart__meta">
									{percentLabel(s.ofFirst)} · {percentLabel(s.dropOff)} drop-off
								</span>
							)}
						</li>
					))}
				</ol>
			</div>
			<p class="ui-chart__readout" aria-live="polite">
				{at !== null && steps[at] ? announce(at) : null}
			</p>
			<div class="ui-visually-hidden">
				<table>
					<caption>{props.caption}</caption>
					<thead>
						<tr>
							<th scope="col">Step</th>
							<th scope="col">Count</th>
							<th scope="col">Share of {first}</th>
							<th scope="col">Drop-off</th>
						</tr>
					</thead>
					<tbody>
						{steps.map((s) => (
							<tr key={s.label}>
								<th scope="row">{s.label}</th>
								<td>{format(s.value)}</td>
								<td>{percentLabel(s.ofFirst)}</td>
								<td>{percentLabel(s.dropOff)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	);
}
