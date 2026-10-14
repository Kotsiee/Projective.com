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
	HEAT_STEPS,
	heatSteps,
	stepCell,
} from "./geometry.ts";
import {
	type ChartBox,
	type ChartColour,
	colourBlindActive,
	useChartCanvas,
	useChartTier,
} from "./useChart.ts";

/** The gap around each cell, in cell units. */
const CELL_INSET = 0.06;

/** Props for {@link HeatmapGrid}. */
export interface HeatmapGridProps {
	caption: string;
	captionHidden?: boolean;
	/** Row labels (e.g. weekdays). */
	rows: readonly string[];
	/** Column labels (e.g. hours). */
	columns: readonly string[];
	/** `values[row][col]`. */
	values: readonly (readonly number[])[];
	/** Show every n-th column label on the axis (default: about six labels). */
	columnLabelEvery?: number;
	formatValue?: (value: number) => ComponentChildren;
	/** The hidden table's corner header (default "Day"). */
	rowHeader?: string;
	tierPolicy?: ChartTierPolicy;
	class?: string;
}

/**
 * HeatmapGrid — a rows × columns grid (7 × 24 for a booking week) on a five-step `--primary` tint
 * ramp over `--surface-1`. Under a colour-blind overlay every step also carries a hatch pattern of
 * rising density, so the value never rides on colour alone.
 *
 * SVG cells by default; Canvas2D above the entity threshold, painting the same ramp and patterns
 * through the theme-bridge. The figure carries a caption and a hidden table; the plot is focusable,
 * ←/→ move along a row (mirrored under RTL), ↑/↓ across rows, Home/End to a row's ends, each cell
 * announced with its row, column and value.
 */
export function HeatmapGrid(props: HeatmapGridProps): JSX.Element {
	const { rows, columns, values } = props;
	const nr = rows.length;
	const nc = columns.length;
	const steps = heatSteps(values);
	const active = useSignal<{ row: number; col: number } | null>(null);
	const captionId = useId(undefined, "ui-chart-caption");
	const patternId = useId(undefined, "ui-chart-heat");
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLSpanElement>(null);
	const tier = useChartTier(nr * nc, props.tierPolicy ?? DEFAULT_TIER_POLICY);
	const format = props.formatValue ?? ((v: number) => v.toLocaleString());
	const every = props.columnLabelEvery ?? Math.max(1, Math.round(nc / 6));
	const at = active.value;
	const valueAt = (r: number, c: number) => values[r]?.[c] ?? 0;

	useChartCanvas({
		canvasRef,
		probeRef,
		enabled: tier === "canvas",
		deps: [steps.map((r) => r.join("")).join("|")],
		paint: (ctx: CanvasRenderingContext2D, box: ChartBox, colour: ChartColour) => {
			const cw = box.width / Math.max(1, nc);
			const ch = box.height / Math.max(1, nr);
			const patterns = colourBlindActive();
			const ink = colour("var(--ui-chart-cp)");
			for (let r = 0; r < nr; r++) {
				for (let c = 0; c < nc; c++) {
					const step = steps[r]?.[c] ?? 0;
					const col = box.rtl ? nc - 1 - c : c;
					const x = col * cw + cw * CELL_INSET;
					const y = r * ch + ch * CELL_INSET;
					const w = cw * (1 - CELL_INSET * 2);
					const h = ch * (1 - CELL_INSET * 2);
					ctx.fillStyle = colour(`var(--ui-chart-heat-${step})`);
					ctx.fillRect(x, y, w, h);
					if (patterns && step > 0) {
						ctx.save();
						ctx.beginPath();
						ctx.rect(x, y, w, h);
						ctx.clip();
						ctx.strokeStyle = ink;
						ctx.lineWidth = 1;
						const gap = Math.max(2, (w + h) / (step * 3));
						for (let d = -h; d < w; d += gap) {
							ctx.moveTo(x + d, y + h);
							ctx.lineTo(x + d + h, y);
						}
						ctx.stroke();
						ctx.restore();
					}
				}
			}
		},
	});

	const describe = (r: number, c: number) =>
		`${rows[r]}, ${columns[c]}: ${valueAt(r, c).toLocaleString()}`;

	return (
		<figure
			class={cx("ui-chart", "ui-chart--heatmap", props.class)}
			role="group"
			aria-labelledby={captionId}
			data-tier={tier}
			style={styleVars({ "--ui-chart-rows": nr, "--ui-chart-cols": nc })}
		>
			<figcaption
				id={captionId}
				class={cx("ui-chart__caption", props.captionHidden && "ui-visually-hidden")}
			>
				{props.caption}
			</figcaption>
			<span ref={probeRef} class="ui-chart__probe" aria-hidden="true" />
			<div class="ui-chart__heat">
				<ol class="ui-chart__rowlabels" aria-hidden="true">
					{rows.map((label) => <li key={label} class="ui-chart__rowlabel">{label}</li>)}
				</ol>
				<div
					class="ui-chart__plot ui-chart__heatplot"
					role="group"
					aria-roledescription="chart"
					aria-label={`${props.caption}. Use the arrow keys to read each cell.`}
					tabIndex={0}
					onKeyDown={(e) => {
						const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
						const key = rtl && e.key === "ArrowLeft"
							? "ArrowRight"
							: rtl && e.key === "ArrowRight"
							? "ArrowLeft"
							: e.key;
						const next = stepCell(at, key, nr, nc);
						if (next === undefined) return;
						e.preventDefault();
						active.value = next;
					}}
					onPointerMove={(e) => {
						const box = e.currentTarget.getBoundingClientRect();
						if (box.width <= 0 || box.height <= 0) return;
						const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
						const xr = (e.clientX - box.left) / box.width;
						const col = Math.min(nc - 1, Math.max(0, Math.floor((rtl ? 1 - xr : xr) * nc)));
						const row = Math.min(
							nr - 1,
							Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * nr)),
						);
						active.value = { row, col };
					}}
					onPointerLeave={() => (active.value = null)}
					onBlur={() => (active.value = null)}
				>
					{tier === "svg"
						? (
							<svg
								class="ui-chart__svg"
								viewBox={`0 0 ${Math.max(1, nc)} ${Math.max(1, nr)}`}
								preserveAspectRatio="none"
								aria-hidden="true"
								focusable="false"
							>
								<defs>
									{Array.from({ length: HEAT_STEPS }, (_, i) => i + 1).map((step) => (
										<pattern
											key={step}
											id={`${patternId}-${step}`}
											width={1 / (step + 1)}
											height={1 / (step + 1)}
											patternUnits="userSpaceOnUse"
											patternTransform="rotate(45)"
										>
											<line class="ui-chart__hatch" x1={0} y1={0} x2={0} y2={1 / (step + 1)} />
										</pattern>
									))}
								</defs>
								{steps.map((row, r) =>
									row.map((step, c) => (
										<g key={`${r}-${c}`}>
											<rect
												class="ui-chart__cell"
												data-step={step}
												x={c + CELL_INSET}
												y={r + CELL_INSET}
												width={1 - CELL_INSET * 2}
												height={1 - CELL_INSET * 2}
											/>
											{step > 0 && (
												<rect
													class="ui-chart__pattern"
													data-pattern={step}
													fill={`url(#${patternId}-${step})`}
													x={c + CELL_INSET}
													y={r + CELL_INSET}
													width={1 - CELL_INSET * 2}
													height={1 - CELL_INSET * 2}
												/>
											)}
										</g>
									))
								)}
							</svg>
						)
						: <canvas ref={canvasRef} class="ui-chart__canvas" aria-hidden="true" />}
					{at && (
						<span
							class="ui-chart__cellmark"
							aria-hidden="true"
							style={styleVars({
								"--ui-chart-x": at.col / Math.max(1, nc),
								"--ui-chart-y": at.row / Math.max(1, nr),
							})}
						/>
					)}
				</div>
				<ol class="ui-chart__collabels" aria-hidden="true">
					{columns.map((label, c) => (
						<li key={label} class="ui-chart__collabel">{c % every === 0 ? label : ""}</li>
					))}
				</ol>
			</div>
			<div class="ui-chart__foot">
				<ul class="ui-chart__ramp" aria-hidden="true">
					<li class="ui-chart__rampkey">Fewer</li>
					{Array.from(
						{ length: HEAT_STEPS + 1 },
						(_, step) => <li key={step} class="ui-chart__rampstep" data-step={step} />,
					)}
					<li class="ui-chart__rampkey">More</li>
				</ul>
				<p class="ui-chart__readout" aria-live="polite">
					{at ? describe(at.row, at.col) : null}
				</p>
			</div>
			<div class="ui-visually-hidden">
				<table>
					<caption>{props.caption}</caption>
					<thead>
						<tr>
							<th scope="col">{props.rowHeader ?? "Day"}</th>
							{columns.map((c) => <th key={c} scope="col">{c}</th>)}
						</tr>
					</thead>
					<tbody>
						{rows.map((r, ri) => (
							<tr key={r}>
								<th scope="row">{r}</th>
								{columns.map((c, ci) => <td key={c}>{format(valueAt(ri, ci))}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	);
}
