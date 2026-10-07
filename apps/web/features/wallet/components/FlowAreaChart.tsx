import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { MoneyView } from "@projective/ui/display/money";
import { styleVars } from "@ui/core/style.ts";
import type { FlowPoint } from "../types/wallet-types.ts";
import { compactMoney, FLOW_VIEW, flowGeometry, nearestIndex } from "../core/chart-geometry.ts";

/** Props for {@link FlowAreaChart}. */
export interface FlowAreaChartProps {
	points: readonly FlowPoint[];
	currency: string;
	/** The window as a phrase ("the last 3 months"), for the accessible name and the table caption. */
	phrase: string;
	/** Whether a bucket spans more than a day, so its row reads "From 5 Oct". */
	spans: boolean;
}

function bucketName(label: string, spans: boolean): string {
	return spans ? `From ${label}` : label;
}

function Signed({ minor, currency }: { minor: number; currency: string }): JSX.Element {
	return minor < 0
		? <MoneyView minor={-minor} currency={currency} size="micro" sign="−" />
		: <MoneyView minor={minor} currency={currency} size="micro" />;
}

/**
 * Cash flow as a diverging area chart: money in rising above a zero baseline, money out falling below
 * it, and the net as a 2px line across both — one axis, one unit. Built from `d3-scale`/`d3-shape`
 * geometry ({@link flowGeometry}) in a fixed viewBox the SVG stretches to fill; the y labels, the
 * crosshair and its dots are HTML placed by the same ratios, so nothing textual is ever stretched.
 *
 * The SVG is `aria-hidden`. The plot itself is ONE focusable group: ←/→ (mirrored under RTL), Home and
 * End move a crosshair that snaps to a bucket and a polite readout names every series there; a pointer
 * does the same by the nearest bucket. A visually hidden table carries every bucket for a reader who
 * never moves the crosshair, so the tooltip enhances and never gates.
 */
export function FlowAreaChart(props: FlowAreaChartProps): JSX.Element {
	const { points, currency } = props;
	const active = useSignal<number | null>(null);
	const geo = flowGeometry(points);
	const last = points.length - 1;
	const at = active.value;
	const focused = at !== null ? points[at] : null;

	const move = (e: KeyboardEvent) => {
		if (points.length === 0) return;
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const forward = rtl ? "ArrowLeft" : "ArrowRight";
		const back = rtl ? "ArrowRight" : "ArrowLeft";
		let next: number | null = at;
		if (e.key === forward) next = at === null ? 0 : Math.min(last, at + 1);
		else if (e.key === back) next = at === null ? last : Math.max(0, at - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = last;
		else if (e.key === "Escape") next = null;
		else return;
		e.preventDefault();
		active.value = next;
	};

	const point = (e: PointerEvent) => {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (box.width <= 0) return;
		const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
		const ratio = (e.clientX - box.left) / box.width;
		active.value = nearestIndex(rtl ? 1 - ratio : ratio, points.length);
	};

	return (
		<figure class="wlt-area">
			<div class="wlt-area__frame">
				<div class="wlt-area__yaxis" aria-hidden="true">
					{geo.ticks.map((tick) => (
						<span
							key={tick.value}
							class="wlt-area__ytick"
							data-zero={tick.value === 0 ? "true" : undefined}
							style={styleVars({ "--wlt-y": tick.ratio })}
						>
							{tick.value === 0 ? "0" : compactMoney(tick.value, currency)}
						</span>
					))}
				</div>
				<div
					class="wlt-area__plot"
					role="group"
					aria-roledescription="chart"
					aria-label={`Money in, money out and net over ${props.phrase}. Use the arrow keys to read each point.`}
					tabIndex={0}
					onKeyDown={move}
					onPointerMove={point}
					onPointerDown={point}
					onPointerLeave={() => {
						active.value = null;
					}}
					onBlur={() => {
						active.value = null;
					}}
				>
					<div class="wlt-area__grid" aria-hidden="true">
						{geo.ticks.map((tick) => (
							<span
								key={tick.value}
								class="wlt-area__gridline"
								data-zero={tick.value === 0 ? "true" : undefined}
								style={styleVars({ "--wlt-y": tick.ratio })}
							/>
						))}
					</div>
					<svg
						class="wlt-area__svg"
						viewBox={`0 0 ${FLOW_VIEW.width} ${FLOW_VIEW.height}`}
						preserveAspectRatio="none"
						aria-hidden="true"
						focusable="false"
					>
						{
							/* Net first: on a day money moved one way only, net IS that series, and its own stroke —
						    drawn on top — keeps the colour that says which way. */
						}
						<path class="wlt-area__net" d={geo.netPath} />
						<path class="wlt-area__fill wlt-area__fill--in" d={geo.inPath} />
						<path class="wlt-area__fill wlt-area__fill--out" d={geo.outPath} />
					</svg>
					{at !== null && focused && (
						<div
							class="wlt-area__cross"
							aria-hidden="true"
							style={styleVars({ "--wlt-x": geo.xs[at] })}
						>
							<span
								class="wlt-area__dot wlt-area__dot--in"
								style={styleVars({ "--wlt-y": geo.yIn[at] })}
							/>
							<span
								class="wlt-area__dot wlt-area__dot--out"
								style={styleVars({ "--wlt-y": geo.yOut[at] })}
							/>
							<span
								class="wlt-area__dot wlt-area__dot--net"
								style={styleVars({ "--wlt-y": geo.yNet[at] })}
							/>
						</div>
					)}
				</div>
				<div class="wlt-area__xaxis" aria-hidden="true">
					<span>{points[0]?.label ?? ""}</span>
					{points.length > 2 && <span>{points[Math.floor(last / 2)]?.label}</span>}
					<span>{points[last]?.label ?? ""}</span>
				</div>
			</div>

			<div class="wlt-area__foot">
				<ul class="wlt-area__legend" aria-hidden="true">
					<li class="wlt-area__key wlt-area__key--in">Money in</li>
					<li class="wlt-area__key wlt-area__key--out">Money out</li>
					<li class="wlt-area__key wlt-area__key--net">Net</li>
				</ul>
				<p class="wlt-area__readout" aria-live="polite">
					{focused
						? (
							<>
								<span class="wlt-area__when">{bucketName(focused.label, props.spans)}</span>
								<span class="wlt-area__pair">
									<span class="wlt-area__swatch wlt-area__swatch--in" aria-hidden="true" />
									<MoneyView minor={focused.inMinor} currency={currency} size="micro" />
									<span class="wlt-area__name">in</span>
								</span>
								<span class="wlt-area__pair">
									<span class="wlt-area__swatch wlt-area__swatch--out" aria-hidden="true" />
									<MoneyView minor={focused.outMinor} currency={currency} size="micro" />
									<span class="wlt-area__name">out</span>
								</span>
								<span class="wlt-area__pair">
									<span class="wlt-area__swatch wlt-area__swatch--net" aria-hidden="true" />
									<Signed minor={focused.netMinor} currency={currency} />
									<span class="wlt-area__name">net</span>
								</span>
							</>
						)
						: (
							<span class="wlt-area__hint">
								Point at the chart, or focus it and use the arrow keys
							</span>
						)}
				</p>
			</div>

			<div class="ui-visually-hidden">
				<table>
					<caption>Money in, money out and net over {props.phrase}</caption>
					<thead>
						<tr>
							<th scope="col">Period</th>
							<th scope="col">In</th>
							<th scope="col">Out</th>
							<th scope="col">Net</th>
						</tr>
					</thead>
					<tbody>
						{points.map((p) => (
							<tr key={p.start}>
								<th scope="row">{bucketName(p.label, props.spans)}</th>
								<td>
									<MoneyView minor={p.inMinor} currency={currency} size="micro" />
								</td>
								<td>
									<MoneyView minor={p.outMinor} currency={currency} size="micro" />
								</td>
								<td>
									<Signed minor={p.netMinor} currency={currency} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	);
}
