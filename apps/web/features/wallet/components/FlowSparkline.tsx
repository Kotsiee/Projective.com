import type { JSX } from "preact";
import type { FlowPoint } from "../types/wallet-types.ts";

/**
 * FlowSparkline — a compact dual in/out mini-chart for the overview (money-in as the accented line, money
 * -out as a muted line), hand-rolled inline SVG (Decision #1 tier-1: low-density SVG; no dependency for a
 * sparkline). The heavier cashflow/burn-down charts on the Activity page use `d3-scale`/`d3-shape`. Pure,
 * token-only (`--primary` / `--text-secondary`), theme-aware. `preserveAspectRatio="none"` lets it fill.
 */
export interface FlowSparklineProps {
	points: FlowPoint[];
	/** Trailing count to render (windowed by the lane's period selector). */
	take?: number;
}

export function FlowSparkline({ points, take }: FlowSparklineProps): JSX.Element {
	const series = take ? points.slice(-take) : points;
	const w = 320;
	const h = 64;
	if (series.length < 2) {
		return (
			<svg
				class="wallet-spark"
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			/>
		);
	}
	const max = Math.max(...series.map((p) => Math.max(p.inMinor, p.outMinor)), 1);
	const step = w / (series.length - 1);
	const y = (v: number) => h - (v / max) * (h - 6) - 3;
	const inPts = series.map((p, i) => `${(i * step).toFixed(1)},${y(p.inMinor).toFixed(1)}`);
	const outPts = series.map((p, i) => `${(i * step).toFixed(1)},${y(p.outMinor).toFixed(1)}`);
	const area = `0,${h} ${inPts.join(" ")} ${w},${h}`;
	const lastIn = inPts[inPts.length - 1].split(",");

	return (
		<svg
			class="wallet-spark"
			viewBox={`0 0 ${w} ${h}`}
			width={w}
			height={h}
			preserveAspectRatio="none"
			role="img"
			aria-label="Money in versus out"
		>
			<polygon class="wallet-spark__area" points={area} />
			<polyline
				class="wallet-spark__out"
				points={outPts.join(" ")}
				fill="none"
				stroke-width="1.6"
				stroke-dasharray="3 3"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<polyline
				class="wallet-spark__in"
				points={inPts.join(" ")}
				fill="none"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<circle class="wallet-spark__dot" cx={lastIn[0]} cy={lastIn[1]} r="2.6" />
		</svg>
	);
}
