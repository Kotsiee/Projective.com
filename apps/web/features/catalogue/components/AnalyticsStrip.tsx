import type { JSX } from "preact";
import { type AnalyticsPeriod, analyticsPeriod } from "../core/catalogue-state.ts";
import { Icon } from "@projective/ui/icons";
import { StarGlyph } from "./catalogue-glyphs.tsx";
import type { CatalogueStats, CatalogueTypeFilter } from "../types/catalogue-types.ts";

/**
 * AnalyticsStrip — the console's KPI row: five stat tiles following the dataviz stat-tile contract
 * (sentence-case label · auto-compact value · optional signed delta · text in text tokens, direction in
 * `--success`/`--danger`). The window it reports over comes from the header band's period switch
 * (the shared `analyticsPeriod` signal, matching `/wallet`, whose header band owns its 30/60/90 range).
 *
 * Two things it deliberately no longer does.
 *
 * **It no longer asserts a number it cannot support.** The strip rolls up the seller's whole catalogue
 * within the active *type* segment — a scope they chose and stay in — but a *search* is a lookup, not a
 * scope, so the figures do not follow it. Previously that was silent, and "9 active listings" could sit
 * directly above a body reading "0 listings". Now the block names its own scope, and says so out loud
 * whenever a search has narrowed the list beneath it.
 *
 * **It no longer draws a sparkline.** The line was 96×22, unlabelled, with no axis and no scale, and
 * its entire information content — first point versus last — was already printed as the delta beside
 * it. Two marks for one fact is decoration; removing it also gave the block back 22px per tile, which
 * is what let it stop eating 29% of a mobile viewport.
 */

export interface AnalyticsStripProps {
	stats: CatalogueStats;
	/** The active type segment — names the scope the figures actually cover. */
	type: CatalogueTypeFilter;
	/** Whether a search is currently narrowing the list below, so the block can disclaim it. */
	narrowed?: boolean;
}

const PERIOD_FACTOR: Record<AnalyticsPeriod, number> = { "7d": 0.25, "30d": 1, "90d": 3 };
const PERIOD_LABEL: Record<AnalyticsPeriod, string> = {
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

/** Compact currency (whole-dollar; $12.9K / $4.2M above 10k). */
function compactMoney(n: number): string {
	if (n >= 10_000) return `$${compact(n)}`;
	return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** The signed period-over-period delta derived from the trend series' shape (first → last). */
function trendDelta(trend: number[]): number | null {
	if (trend.length < 2) return null;
	const first = trend[0] || 1;
	const last = trend[trend.length - 1];
	return Math.round(((last - first) / first) * 100);
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
	const period = analyticsPeriod.value;
	const factor = PERIOD_FACTOR[period];
	const views = Math.round(stats.views30d * factor);
	const orders = Math.round(stats.orders * factor);
	const revenue = Math.round(stats.revenue * factor);
	const delta = trendDelta(stats.trend);

	return (
		<section class="cat-analytics" aria-label="Catalogue analytics">
			<h2 class="cat-analytics__scope">
				Last {PERIOD_LABEL[period]} across {scopeLabel(type)}
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
				<StatTile label="Views" value={compact(views)} delta={delta} />
				<StatTile label="Orders & bookings" value={compact(orders)} />
				<StatTile label="Revenue" value={compactMoney(revenue)} delta={delta} />
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
