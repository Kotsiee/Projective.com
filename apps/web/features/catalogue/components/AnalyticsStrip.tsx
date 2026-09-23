import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { StarGlyph } from "./catalogue-glyphs.tsx";
import { halfOverHalf } from "../core/catalogue-model.ts";
import type {
	CataloguePeriod,
	CatalogueStats,
	CatalogueTypeFilter,
} from "../types/catalogue-types.ts";

/**
 * AnalyticsStrip — the console's KPI row: five stat tiles following the dataviz stat-tile contract
 * (sentence-case label · auto-compact value · optional signed delta · text in text tokens, direction in
 * `--success`/`--danger`). The window the figures cover is the one the SERVER counted them over
 * (`stats.period`), chosen by the header band's period switch — never scaled here: a thirty-day total
 * multiplied by a quarter is not a seven-day total, it is a guess printed as a fact.
 *
 * Three things it deliberately does not do.
 *
 * **It does not assert a number it cannot support.** The strip rolls up the seller's whole catalogue
 * within the active *type* segment — a scope they chose and stay in — but a *search* is a lookup, not a
 * scope, so the figures do not follow it. The block names its own scope, and says so out loud whenever
 * a search has narrowed the list beneath it. Views are a lifetime counter, so that tile says "all time"
 * rather than borrowing the window's heading.
 *
 * **It does not invent a trend.** The delta compares the later half of the window's weekly revenue
 * with the earlier half, and is withheld when the earlier half sold nothing — a rise from zero has no
 * percentage, and printing one (the old first-bucket formula divided by 1 in that case) produced
 * figures in the tens of thousands.
 *
 * **It does not draw a sparkline.** The line was 96×22, unlabelled, with no axis and no scale, and its
 * entire information content was already printed as the delta beside it.
 */

export interface AnalyticsStripProps {
	stats: CatalogueStats;
	/** The active type segment — names the scope the figures actually cover. */
	type: CatalogueTypeFilter;
	/** Whether a search is currently narrowing the list below, so the block can disclaim it. */
	narrowed?: boolean;
}

const PERIOD_LABEL: Record<CataloguePeriod, string> = {
	"7d": "7 days",
	"30d": "30 days",
	"90d": "90 days",
};

/** Auto-compact a magnitude: 1,284 / 12.9K / 4.2M. */
function compact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return n.toLocaleString("en-US");
}

/** What the figures cover, in the seller's own words. */
function scopeLabel(type: CatalogueTypeFilter): string {
	return type === "service"
		? "all your services"
		: type === "product"
		? "all your products"
		: "your whole catalogue";
}

export function AnalyticsStrip({ stats, type, narrowed }: AnalyticsStripProps): JSX.Element {
	const delta = halfOverHalf(stats.trend);

	return (
		<section class="cat-analytics" aria-label="Catalogue analytics">
			<h2 class="cat-analytics__scope">
				Last {PERIOD_LABEL[stats.period]} across {scopeLabel(type)}
				{narrowed && (
					<span class="cat-analytics__disclaim">
						{" "}— not affected by your search
					</span>
				)}
			</h2>

			<div class="cat-kpis">
				{
					/*
					 * "not archived", not "total". The roll-up excludes archived listings but the body list
					 * includes them, so a bare "7 total" sat beside 8 rows and read as an error. The caption
					 * names the exclusion instead of hiding it.
					 */
				}
				<StatTile
					label="Published"
					value={compact(stats.activeListings)}
					caption={`of ${stats.totalListings} not archived`}
				/>
				<StatTile label="Views" value={compact(stats.views)} caption="All time" />
				<StatTile label="Orders & bookings" value={compact(stats.orders)} />
				<StatTile
					label="Revenue"
					value={stats.revenueLabel || "—"}
					delta={delta}
					caption={delta == null ? undefined : "Second half vs first half"}
				/>
				<StatTile
					label="Avg rating"
					value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}
					icon={<StarGlyph size={14} filled />}
				/>
			</div>
		</section>
	);
}

// #region Stat tile
interface StatTileProps {
	label: string;
	value: string;
	caption?: string;
	delta?: number | null;
	icon?: JSX.Element;
}

function StatTile({ label, value, caption, delta, icon }: StatTileProps): JSX.Element {
	const dir = delta == null ? 0 : Math.sign(delta);
	return (
		<div class="cat-tile">
			<span class="cat-tile__label">{label}</span>
			<div class="cat-tile__row">
				<span class="cat-tile__value">
					{icon && <span class="cat-tile__vicon" aria-hidden="true">{icon}</span>}
					{value}
				</span>
				{delta != null && (
					<span class="cat-tile__delta" data-dir={dir > 0 ? "up" : dir < 0 ? "down" : "flat"}>
						<Icon name={dir > 0 ? "arrow-up" : dir < 0 ? "arrow-down" : "minus"} />{" "}
						{Math.abs(delta)}%
					</span>
				)}
			</div>
			{caption && <span class="cat-tile__caption">{caption}</span>}
		</div>
	);
}
// #endregion
