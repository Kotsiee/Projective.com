import type { JSX } from "preact";
import { buildBurn } from "../core/burn-chart.ts";
import { Money } from "./Money.tsx";
import type { BusinessExtras } from "../types/wallet-types.ts";

/**
 * BurnDownPanel — planned versus actual spend against a budget.
 *
 * Planned is a dashed reference line and actual a solid one, with a tinted divergence region drawn
 * ONLY where actual has run past planned. A permanently-rendered zero-area region would put a wash
 * of warning colour on a perfectly healthy budget, which is exactly the kind of ambient alarm this
 * surface avoids.
 */
export interface BurnDownPanelProps {
	burn: BusinessExtras["burnDown"];
}

const W = 720;
const H = 176;

export function BurnDownPanel(props: BurnDownPanelProps): JSX.Element {
	const b = props.burn;
	const geo = buildBurn(b.points, W, H);
	const utilisation = (b.utilizationBp / 100).toFixed(0);
	const over = b.utilizationBp >= 10000;

	return (
		<section class="wlt-burn" aria-labelledby="wlt-burn-title">
			<header class="wlt-burn__head">
				<h3 class="wlt-burn__title wlt-label" id="wlt-burn-title">{b.label}</h3>
				<span class="wlt-burn__util wlt-num" data-over={over ? "true" : "false"}>
					{utilisation}% used
				</span>
			</header>

			<dl class="wlt-burn__figures">
				<div class="wlt-burn__figure">
					<dt class="wlt-burn__figure-label">Budget</dt>
					<dd class="wlt-burn__figure-value">
						<Money value={b.budget} size="figure" showFx={false} />
					</dd>
				</div>
				<div class="wlt-burn__figure">
					<dt class="wlt-burn__figure-label">Spent</dt>
					<dd class="wlt-burn__figure-value">
						<Money value={b.spent} size="figure" tone="debit" showFx={false} />
					</dd>
				</div>
				<div class="wlt-burn__figure">
					<dt class="wlt-burn__figure-label">Remaining</dt>
					<dd class="wlt-burn__figure-value">
						<Money value={b.remaining} size="figure" showFx={false} />
					</dd>
				</div>
			</dl>

			<div class="wlt-burn__chart">
				<svg
					class="wlt-chart__svg"
					viewBox={`0 0 ${W} ${H}`}
					preserveAspectRatio="none"
					role="img"
					aria-label={`Budget burn-down. ${b.spent.display} of ${b.budget.display} spent, ${utilisation}% of budget.`}
				>
					{geo.over && <path class="wlt-burn__over" d={geo.over} />}
					{geo.planned && <path class="wlt-burn__planned" d={geo.planned} />}
					{geo.actual && <path class="wlt-burn__actual" d={geo.actual} />}
				</svg>
			</div>

			{/* The series, for anyone who cannot read the chart. */}
			<table class="ui-visually-hidden">
				<caption>Planned versus actual cumulative spend</caption>
				<thead>
					<tr>
						<th scope="col">Point</th>
						<th scope="col">Planned</th>
						<th scope="col">Actual</th>
					</tr>
				</thead>
				<tbody>
					{b.points.map((p) => (
						<tr key={p.label}>
							<th scope="row">{p.label}</th>
							<td>{p.plannedMinor}</td>
							<td>{p.actualMinor}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
