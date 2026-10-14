import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { halfOverHalf } from "../core/catalogue-model.ts";
import type { CataloguePeriod, CatalogueStats } from "../types/catalogue-types.ts";

/**
 * CatalogueRollups — the header band's one-line summary of the whole catalogue, as inline middot
 * text rather than tiles (the tiles belong to the Analytics view): revenue for the window the server
 * counted, with its direction as an arrow and a word, then orders and bookings, what is live, and the
 * average review. Figures are `tabular-nums`, and colour never carries the direction alone.
 */

const PERIOD_LABEL: Record<CataloguePeriod, string> = {
	"7d": "7 days",
	"30d": "30 days",
	"90d": "90 days",
};

function Delta({ delta }: { delta: number }): JSX.Element {
	const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
	const icon = dir === "up" ? "arrow-up" : dir === "down" ? "arrow-down" : "minus";
	return (
		<span class={`cat-rollups__delta cat-rollups__delta--${dir}`}>
			<Icon name={icon} />
			<span>{dir === "flat" ? "level" : `${dir} ${Math.abs(delta)}%`}</span>
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
	const delta = halfOverHalf(stats.trend);
	const items: { key: string; node: JSX.Element }[] = [
		{
			key: "revenue",
			node: (
				<>
					<Figure value={stats.revenueLabel || "Nothing sold"} /> in {PERIOD_LABEL[stats.period]}
					{delta !== null && <Delta delta={delta} />}
				</>
			),
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
