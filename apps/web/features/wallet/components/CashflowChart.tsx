import type { JSX } from "preact";
import { scaleBand, scaleLinear } from "d3-scale";
import { max } from "d3-array";
import type { FlowPoint } from "../types/wallet-types.ts";

/**
 * CashflowChart — grouped in/out bars over the flow buckets, using `d3-scale` (band + linear) for the
 * geometry per the tiered chart engine (Decision #1: D3 scales/geometry + low-density SVG). Token-only
 * (`--primary` money-in, `--text-secondary` money-out), theme-aware, responsive via a `viewBox`. Pure —
 * the fat service supplies the (already-converted) minor-unit values; this only lays them out.
 */
export interface CashflowChartProps {
	points: FlowPoint[];
	height?: number;
}

export function CashflowChart({ points, height = 220 }: CashflowChartProps): JSX.Element {
	const w = 720;
	const h = height;
	const padTop = 12;
	const padBottom = 22;
	if (points.length === 0) {
		return <svg class="wallet-chart" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
	}
	const x = scaleBand<number>().domain(points.map((_, i) => i)).range([0, w]).padding(0.35);
	const yMax = max(points, (p: FlowPoint) => Math.max(p.inMinor, p.outMinor)) ?? 1;
	const y = scaleLinear().domain([0, yMax || 1]).range([h - padBottom, padTop]);
	const bw = x.bandwidth() / 2;
	// Show ~8 labels max to avoid clutter.
	const labelEvery = Math.ceil(points.length / 8);

	return (
		<svg
			class="wallet-chart"
			viewBox={`0 0 ${w} ${h}`}
			width={w}
			height={h}
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="Money in versus out by period"
		>
			<line class="wallet-chart__axis" x1={0} x2={w} y1={h - padBottom} y2={h - padBottom} />
			{points.map((p, i) => {
				const bx = x(i) ?? 0;
				return (
					<g key={i}>
						<rect
							class="wallet-chart__bar wallet-chart__bar--in"
							x={bx}
							y={y(p.inMinor)}
							width={bw}
							height={Math.max(0, h - padBottom - y(p.inMinor))}
							rx={2}
						/>
						<rect
							class="wallet-chart__bar wallet-chart__bar--out"
							x={bx + bw}
							y={y(p.outMinor)}
							width={bw}
							height={Math.max(0, h - padBottom - y(p.outMinor))}
							rx={2}
						/>
						{i % labelEvery === 0 && (
							<text class="wallet-chart__label" x={bx + bw} y={h - 6} text-anchor="middle">
								{p.label}
							</text>
						)}
					</g>
				);
			})}
		</svg>
	);
}
