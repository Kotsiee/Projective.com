import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { deltaLabel, percentLabel, periodPhrase } from "../core/analytics-view.ts";
import type { CatalogueStats } from "../types/catalogue-types.ts";

/**
 * CatalogueRollups — the header band's two summaries of the whole catalogue, split by what they
 * answer (Decision #221). {@link CatalogueHealth} sits under the title as middot meta text — how much
 * is live and how it is rated. {@link CatalogueSales} sits at the band's end as three unboxed figures,
 * each over its label like the title over its meta line — gross volume with its change, orders and
 * conversion, copied from the Analytics read for the same window so the band never disagrees with the
 * canvas. Figures are `tabular-nums`; a direction is an arrow and a word, never colour alone; a
 * conversion below its threshold is left out, not printed as 0%.
 */

function Delta({ change }: { change: number }): JSX.Element {
	const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
	const icon = dir === "up" ? "arrow-up" : dir === "down" ? "arrow-down" : "minus";
	const amount = (deltaLabel(Math.abs(change)) ?? "").replace(/^\+/, "");
	return (
		<span class={`cat-rollups__delta cat-rollups__delta--${dir}`}>
			<Icon name={icon} />
			<span>{dir === "flat" ? "level" : `${dir} ${amount}`}</span>
		</span>
	);
}

/** Props for {@link CatalogueHealth} and {@link CatalogueSales}. */
export interface CatalogueRollupsProps {
	stats: CatalogueStats;
}

/** What is live and how it is rated, as one line of meta text. */
export function CatalogueHealth({ stats }: CatalogueRollupsProps): JSX.Element {
	return (
		<span class="cat-rollups">
			<span class="cat-rollups__item">
				<span class="cat-rollups__figure">{stats.activeListings.toLocaleString("en-US")}</span>
				{` of ${stats.totalListings.toLocaleString("en-US")} live`}
			</span>
			<span class="cat-rollups__dot" aria-hidden="true">·</span>
			<span class="cat-rollups__item">
				{stats.avgRating > 0
					? (
						<>
							Rated <span class="cat-rollups__figure">{stats.avgRating.toFixed(1)}</span>
						</>
					)
					: "No reviews yet"}
			</span>
		</span>
	);
}

interface Stat {
	key: string;
	label: string;
	value: string;
	delta?: number | null;
}

/** Gross volume, orders and conversion over the window, each a figure over its label. */
export function CatalogueSales({ stats }: CatalogueRollupsProps): JSX.Element {
	const window = periodPhrase(stats.period);
	const sold = stats.revenue > 0 || stats.orders > 0;
	const items: Stat[] = [
		{
			key: "revenue",
			label: `Gross · ${window}`,
			value: sold ? stats.revenueLabel : "Nothing sold",
			delta: sold ? stats.revenueChange : null,
		},
		{ key: "orders", label: "Orders", value: stats.orders.toLocaleString("en-US") },
		...(stats.conversion !== null
			? [{ key: "conversion", label: "Conversion", value: percentLabel(stats.conversion) }]
			: []),
	];
	return (
		<dl class="cat-sales" aria-label={`Sales over ${window}`}>
			{items.map((s) => (
				<div key={s.key} class="cat-sales__stat">
					<dt class="cat-sales__label">{s.label}</dt>
					<dd class="cat-sales__value">
						{s.value}
						{s.delta !== undefined && s.delta !== null && <Delta change={s.delta} />}
					</dd>
				</div>
			))}
		</dl>
	);
}
