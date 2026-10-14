import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { deltaLabel, percentLabel, periodPhrase } from "../core/analytics-view.ts";
import type { CatalogueStats } from "../types/catalogue-types.ts";

/**
 * CatalogueRollups — the header band's one-line summary of the whole catalogue, as inline middot
 * text rather than tiles (the tiles belong to the Analytics view). The sales figures ARE those tiles:
 * gross volume with its change on the previous window, orders and conversion, copied from the same
 * analytics read for the same window, so the header never disagrees with the canvas below it. Then
 * what is live and the average review. Figures are `tabular-nums`; a direction is an arrow and a word,
 * never colour alone; a conversion below its threshold is left out of the sentence, not printed as 0%.
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

function Figure({ value }: { value: string }): JSX.Element {
	return <span class="cat-rollups__figure">{value}</span>;
}

/** Props for {@link CatalogueRollups}. */
export interface CatalogueRollupsProps {
	stats: CatalogueStats;
}

/** The catalogue's rollup sentence. */
export function CatalogueRollups({ stats }: CatalogueRollupsProps): JSX.Element {
	const sold = stats.revenue > 0 || stats.orders > 0;
	const items: { key: string; node: JSX.Element }[] = [
		{
			key: "revenue",
			node: sold
				? (
					<>
						<Figure value={stats.revenueLabel} /> over {periodPhrase(stats.period)}
						{stats.revenueChange !== null && <Delta change={stats.revenueChange} />}
					</>
				)
				: <>Nothing sold over {periodPhrase(stats.period)}</>,
		},
		{
			key: "orders",
			node: (
				<>
					<Figure value={stats.orders.toLocaleString("en-US")} />{" "}
					{stats.orders === 1 ? "order" : "orders"}
				</>
			),
		},
		...(stats.conversion !== null
			? [{
				key: "conversion",
				node: (
					<>
						<Figure value={percentLabel(stats.conversion)} /> conversion
					</>
				),
			}]
			: []),
		{
			key: "live",
			node: (
				<>
					<Figure value={stats.activeListings.toLocaleString("en-US")} /> of {stats.totalListings}
					{" "}
					live
				</>
			),
		},
		{
			key: "rating",
			node: stats.avgRating > 0
				? (
					<>
						Rated <Figure value={stats.avgRating.toFixed(1)} />
					</>
				)
				: <>No reviews yet</>,
		},
	];
	return (
		<p class="cat-rollups">
			{items.map(({ key, node }, i) => (
				<span key={key} class="cat-rollups__item">
					{i > 0 && <span class="cat-rollups__dot" aria-hidden="true">·</span>}
					{node}
				</span>
			))}
		</p>
	);
}
