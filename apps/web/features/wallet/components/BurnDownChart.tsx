import type { JSX } from "preact";
import type { BudgetBurn } from "../types/wallet-types.ts";

/**
 * BurnDownChart — a budget burn-down (planned vs actual cumulative spend) as an inline SVG area+line
 * (Decision #1 tier-1). `--primary` actual over a muted planned guide; over-budget the actual line tints
 * `--danger`. Token-only, theme-aware, `preserveAspectRatio="none"` so it fills its box. Pure; a
 * `compact` prop shrinks it for the Overview (the Activity page renders it full-height).
 */
export interface BurnDownChartProps {
	data: BudgetBurn;
	compact?: boolean;
}

export function BurnDownChart({ data, compact }: BurnDownChartProps): JSX.Element {
	const w = 480;
	const h = compact ? 90 : 220;
	const pts = data.points;
	if (pts.length < 2) {
		return (
			<svg
				class="wallet-burn"
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			/>
		);
	}
	const max = Math.max(...pts.map((p) => Math.max(p.plannedMinor, p.actualMinor)), 1);
	const step = w / (pts.length - 1);
	const y = (v: number) => h - (v / max) * (h - 8) - 4;
	const planned = pts.map((p, i) => `${(i * step).toFixed(1)},${y(p.plannedMinor).toFixed(1)}`);
	const actual = pts.map((p, i) => `${(i * step).toFixed(1)},${y(p.actualMinor).toFixed(1)}`);
	const area = `0,${h} ${actual.join(" ")} ${w},${h}`;
	const over = data.utilizationBp >= 10000;

	return (
		<svg
			class="wallet-burn"
			viewBox={`0 0 ${w} ${h}`}
			width={w}
			height={h}
			preserveAspectRatio="none"
			role="img"
			aria-label={`Budget burn-down — ${Math.round(data.utilizationBp / 100)}% used`}
			data-over={over ? "true" : undefined}
		>
			<polygon class="wallet-burn__area" points={area} />
			<polyline
				class="wallet-burn__planned"
				points={planned.join(" ")}
				fill="none"
				stroke-width="1.4"
				stroke-dasharray="4 4"
			/>
			<polyline
				class="wallet-burn__actual"
				points={actual.join(" ")}
				fill="none"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}
