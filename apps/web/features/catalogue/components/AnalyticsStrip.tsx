import type { JSX } from "preact";
import { type AnalyticsPeriod, analyticsPeriod } from "../core/catalogue-state.ts";
import { ChartIcon, StarGlyph } from "./catalogue-glyphs.tsx";
import type { CatalogueStats } from "../types/catalogue-types.ts";
import { Icon } from "@projective/ui/icons";

/**
 * AnalyticsStrip — the console's light KPI row: 5 stat tiles (Active listings · Views · Orders ·
 * Revenue · Avg rating) following the dataviz stat-tile contract (sentence-case label · auto-compact
 * value · optional signed delta vs the named period · a de-emphasised sparkline with the current point
 * accented). Text wears text tokens; only the sparkline mark carries the accent (`--primary`); the
 * delta carries direction via `--success`/`--danger`. Token-only + theme-aware. It reports over the
 * window chosen by the lane footer's period selector (the shared `analyticsPeriod` signal), scaling the
 * flow metrics; the deep analytics dashboard is a separate future surface ("Full analytics →").
 */

export interface AnalyticsStripProps {
	stats: CatalogueStats;
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

export function AnalyticsStrip({ stats }: AnalyticsStripProps): JSX.Element {
	const period = analyticsPeriod.value;
	const factor = PERIOD_FACTOR[period];
	const views = Math.round(stats.views30d * factor);
	const orders = Math.round(stats.orders * factor);
	const revenue = Math.round(stats.revenue * factor);
	const delta = trendDelta(stats.trend);

	return (
		<div class="cat-kpis" role="group" aria-label="Catalogue analytics">
			<StatTile
				label="Active listings"
				value={compact(stats.activeListings)}
				caption={`${stats.totalListings} total`}
			/>
			<StatTile
				label={`Views · ${PERIOD_LABEL[period]}`}
				value={compact(views)}
				delta={delta}
				trend={stats.trend}
			/>
			<StatTile label="Orders & bookings" value={compact(orders)} caption={PERIOD_LABEL[period]} />
			<StatTile
				label="Revenue"
				value={compactMoney(revenue)}
				delta={delta}
				caption={PERIOD_LABEL[period]}
			/>
			<StatTile
				label="Avg rating"
				value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}
				icon={<StarGlyph size={15} filled />}
			/>
			<a class="cat-kpis__more" href="/catalogue?view=analytics" aria-label="Open full analytics">
				<ChartIcon size={15} /> Full analytics →
			</a>
		</div>
	);
}

// #region Stat tile
interface StatTileProps {
	label: string;
	value: string;
	caption?: string;
	delta?: number | null;
	trend?: number[];
	icon?: JSX.Element;
}

function StatTile({ label, value, caption, delta, trend, icon }: StatTileProps): JSX.Element {
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
			{trend && trend.length > 1
				? <Sparkline series={trend} />
				: caption
				? <span class="cat-tile__caption">{caption}</span>
				: null}
		</div>
	);
}

/** A minimal 2px sparkline — de-emphasised line + accented current point (dataviz stat-tile trend). */
function Sparkline({ series }: { series: number[] }): JSX.Element {
	const w = 96;
	const h = 22;
	const max = Math.max(...series, 1);
	const min = Math.min(...series, 0);
	const span = max - min || 1;
	const step = series.length > 1 ? w / (series.length - 1) : w;
	const pts = series.map((v, i) => {
		const x = i * step;
		const y = h - ((v - min) / span) * (h - 3) - 1.5;
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	});
	const last = pts[pts.length - 1].split(",");
	return (
		<svg
			class="cat-spark"
			viewBox={`0 0 ${w} ${h}`}
			width={w}
			height={h}
			aria-hidden="true"
			preserveAspectRatio="none"
		>
			<polyline
				class="cat-spark__line"
				points={pts.join(" ")}
				fill="none"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<circle class="cat-spark__dot" cx={last[0]} cy={last[1]} r="2.5" />
		</svg>
	);
}
// #endregion
