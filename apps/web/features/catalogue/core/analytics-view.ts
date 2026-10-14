import {
	type AnalyticsPeriod,
	type CatalogueAnalytics,
	type ConsoleUrlState,
	type FunnelStep,
	type HeatCell,
	KEYWORD_MIN_SESSIONS,
	type KeywordRow,
	type MetricDelta,
	type MetricKey,
	type MetricTile,
	RATE_MIN_DENOMINATOR,
	type SeriesBucket,
	type SeriesPoint,
	type TopListingRow,
} from "../types/catalogue-types.ts";

/**
 * analytics-view — the PURE view-model behind `AnalyticsCanvas` (plan §4.7): an analytics read in,
 * what each region prints out. Nothing here formats a figure the server already formatted (a tile's
 * `display` is printed verbatim), and nothing turns a missing figure into a zero: a rate below its
 * threshold stays "not enough data", with the threshold said in words.
 */

// #region Period
/** The windows the period switch offers, in order. */
export const ANALYTICS_PERIODS: readonly AnalyticsPeriod[] = ["7d", "30d", "90d", "12m"];

const PERIOD_PHRASE: Readonly<Record<AnalyticsPeriod, string>> = {
	"7d": "7 days",
	"30d": "30 days",
	"90d": "90 days",
	"12m": "12 months",
};

/** A window as prose ("30 days"). */
export function periodPhrase(period: AnalyticsPeriod): string {
	return PERIOD_PHRASE[period];
}

/** The period switch's segments. */
export function periodOptions(): { label: string; value: AnalyticsPeriod }[] {
	return ANALYTICS_PERIODS.map((value) => ({ label: PERIOD_PHRASE[value], value }));
}
// #endregion

// #region Scope + query
/** What one canvas covers: a console scope, or one listing by its `svc-`/`prd-` slug. */
export type AnalyticsTarget =
	| { kind: "catalogue"; filter: string }
	| { kind: "listing"; slug: string };

/**
 * What the console's Analytics view covers: an explicit `?scope=` (a delivery model or a collection)
 * when one is set, else the lane's type segment — the same segment the header rollups are counted
 * over, so with no explicit scope the header and the canvas describe the same listings.
 */
export function consoleAnalyticsTarget(
	state: Pick<ConsoleUrlState, "scope" | "type">,
): AnalyticsTarget {
	return { kind: "catalogue", filter: state.scope !== "all" ? state.scope : state.type };
}

/** The `/api/catalogue/analytics` query for a target and window (and the dev axis, when set). */
export function analyticsQuery(
	target: AnalyticsTarget,
	period: AnalyticsPeriod,
	sim?: string | null,
): string {
	const qs = new URLSearchParams();
	if (target.kind === "listing") qs.set("listing", target.slug);
	else if (target.filter !== "all") qs.set("scope", target.filter);
	if (period !== "30d") qs.set("period", period);
	if (sim) qs.set("sim", sim);
	return qs.toString();
}

/** A stable key for a read: equal keys need no refetch. */
export function analyticsKey(target: AnalyticsTarget, period: AnalyticsPeriod): string {
	return analyticsQuery(target, period);
}
// #endregion

// #region Figures
/** A rate as the tiles print it: one decimal ("3.4%"). */
export function percentLabel(rate: number): string {
	return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;
}

/**
 * A delta as signed meta text ("+12.4%", "−3%", "0%"), with a true minus so the tile reads the
 * direction from the sign; `null` when there is no previous window to compare with.
 */
export function deltaLabel(change: number | null | undefined): string | null {
	if (change === null || change === undefined || !Number.isFinite(change)) return null;
	const magnitude = `${Math.abs(Math.round(change * 10) / 10)}%`;
	return change > 0 ? `+${magnitude}` : change < 0 ? `−${magnitude}` : magnitude;
}

/** A delta spoken in full ("up 12.4% on the previous 30 days"). */
export function deltaPhrase(delta: MetricDelta | null, period: AnalyticsPeriod): string | null {
	if (!delta) return null;
	const word = delta.direction === "up" ? "up" : delta.direction === "down" ? "down" : "level";
	const pct = `${Math.abs(Math.round(delta.change * 10) / 10)}%`;
	return delta.direction === "flat"
		? `level with the previous ${periodPhrase(period)}`
		: `${word} ${pct} on the previous ${periodPhrase(period)}`;
}

const COUNT = new Intl.NumberFormat("en-US");

/** A count as printed ("1,204"). */
export function countLabel(n: number): string {
	return COUNT.format(n);
}
// #endregion

// #region Tiles
/** The tiles the stat row shows, in order. Churn is its own line, not a tile. */
export const TILE_KEYS: readonly MetricKey[] = ["gross", "orders", "conversion", "standing_impact"];

/** The words a tile prints when its figure is below threshold. */
export const NOT_ENOUGH_DATA = "Not enough data yet";

/** Why a tile has no figure, said as the threshold it has not reached. */
const THRESHOLD_NOTE: Partial<Record<MetricKey, string>> = {
	conversion:
		`Conversion is shown once the window has at least ${RATE_MIN_DENOMINATOR} views, so a handful of visits cannot read as 0% or 100%.`,
	churn:
		`Churn is shown once the window has at least ${RATE_MIN_DENOMINATOR} orders, so one cancellation cannot read as a trend.`,
	ctr: `Click-through is shown once a query has at least ${RATE_MIN_DENOMINATOR} impressions.`,
	standing_impact:
		"Standing impact counts reviews and completed stages on listings with a CREATE category. None of these listings has one yet.",
};

/** One stat tile as the row renders it. */
export interface TileView {
	key: MetricKey;
	label: string;
	/** The figure — the server's own `display`, or {@link NOT_ENOUGH_DATA}. */
	value: string;
	/** Signed meta text, or `null` with no comparison. */
	delta: string | null;
	/** The delta in words, for assistive tech. */
	deltaSpoken: string | null;
	sufficient: boolean;
	/** The threshold explanation the tooltip carries; set only when the tile is insufficient. */
	note: string | null;
}

/**
 * What an insufficient tile prints. Standing impact is missing for a reason, not for want of data
 * (no listing in scope has a CREATE category), so it keeps the server's own words for that.
 */
function insufficientValue(tile: MetricTile): string {
	return tile.key === "standing_impact" && tile.display ? tile.display : NOT_ENOUGH_DATA;
}

function tileView(tile: MetricTile, period: AnalyticsPeriod): TileView {
	const enough = tile.sufficient && tile.value !== null;
	return {
		key: tile.key,
		label: tile.label,
		value: enough ? tile.display : insufficientValue(tile),
		delta: enough ? deltaLabel(tile.delta?.change) : null,
		deltaSpoken: enough ? deltaPhrase(tile.delta, period) : null,
		sufficient: enough,
		note: enough ? null : THRESHOLD_NOTE[tile.key] ?? null,
	};
}

/** The stat row: gross volume, orders, conversion and standing impact, in that order. */
export function toTiles(analytics: CatalogueAnalytics): TileView[] {
	return TILE_KEYS.flatMap((key) => {
		const tile = analytics.tiles.find((t) => t.key === key);
		return tile ? [tileView(tile, analytics.period)] : [];
	});
}

/** The churn line under the tiles. */
export interface ChurnView {
	/** "2.4% of orders were cancelled or refunded", or {@link NOT_ENOUGH_DATA}. */
	text: string;
	delta: string | null;
	sufficient: boolean;
	/** The threshold explanation, set only when the figure is withheld. */
	note: string | null;
}

/** The churn tile as one sentence; `null` when the read carries no churn tile. */
export function toChurn(analytics: CatalogueAnalytics): ChurnView | null {
	const tile = analytics.tiles.find((t) => t.key === "churn");
	if (!tile) return null;
	if (!tile.sufficient || tile.value === null) {
		return {
			text: NOT_ENOUGH_DATA,
			delta: null,
			sufficient: false,
			note: THRESHOLD_NOTE.churn ?? null,
		};
	}
	return {
		text: `${tile.display} of orders were cancelled or refunded`,
		delta: deltaLabel(tile.delta?.change),
		sufficient: true,
		note: null,
	};
}
// #endregion

// #region Revenue
/** The revenue area chart's inputs. */
export interface RevenueView {
	labels: string[];
	values: number[];
	/** How a bucket is named in the readout and the hidden table ("Week of 5 Oct"). */
	names: string[];
	/** Whether anything was sold in the window at all. */
	any: boolean;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

/** A `YYYY-MM-DD` UTC day as "13 Oct". */
export function dayLabel(day: string): string {
	return DAY_MONTH.format(new Date(`${day}T00:00:00Z`));
}

/** A whole-unit amount as a compact axis tick ("£1.2K"); a bad currency code prints the number. */
export function moneyTick(value: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-GB", {
			style: "currency",
			currency,
			notation: "compact",
			maximumFractionDigits: 1,
		}).format(value);
	} catch {
		return COUNT.format(value);
	}
}

/** The revenue series as the chart draws it. */
export function toRevenue(points: readonly SeriesPoint[], bucket: SeriesBucket): RevenueView {
	const labels = points.map((p) => dayLabel(p.date));
	return {
		labels,
		values: points.map((p) => (Number.isFinite(p.value) ? p.value : 0)),
		names: labels.map((l) => (bucket === "week" ? `Week of ${l}` : l)),
		any: points.some((p) => p.value > 0),
	};
}
// #endregion

// #region Funnel
/** The funnel as the chart draws it, or why it cannot be drawn honestly. */
export interface FunnelView {
	steps: { label: string; value: number }[];
	/**
	 * Whether the first step clears {@link RATE_MIN_DENOMINATOR}: below it the chart's step-to-step
	 * percentages would be noise, so the canvas prints the counts as a sentence instead.
	 */
	sufficient: boolean;
	/** Whether any step has anything in it. */
	any: boolean;
}

/** The impressions → views → checkout → orders funnel. */
export function toFunnel(funnel: readonly FunnelStep[]): FunnelView {
	const steps = funnel.map((s) => ({ label: s.label, value: Math.max(0, s.count) }));
	const first = steps[0]?.value ?? 0;
	return {
		steps,
		sufficient: first >= RATE_MIN_DENOMINATOR,
		any: steps.some((s) => s.value > 0),
	};
}

/** Why a thin funnel is printed as counts rather than drawn. */
export const RATE_MIN_FUNNEL_NOTE =
	`The funnel is drawn once the window has at least ${RATE_MIN_DENOMINATOR} impressions; below that, step-to-step percentages would mostly be noise.`;

/** The funnel's counts as one middot sentence, for a funnel too thin to chart. */
export function funnelSentence(view: FunnelView): string {
	return view.steps.map((s) => `${countLabel(s.value)} ${s.label.toLowerCase()}`).join(" · ");
}
// #endregion

// #region Heatmap
/** Weekday rows, Monday first; the read keys 0 = Sunday. */
const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** An hour of the day as an axis label ("09:00"). */
export function hourLabel(hour: number): string {
	return `${String(hour).padStart(2, "0")}:00`;
}

/** The 7 × 24 booking grid as the chart draws it. */
export interface HeatmapView {
	rows: string[];
	columns: string[];
	/** `values[row][hour]`, rows Monday → Sunday. */
	values: number[][];
	total: number;
	/** The busiest cell, for the caption; `null` when nothing was booked. */
	peak: { day: string; hour: string; value: number } | null;
}

/**
 * Normalise the read's cells into a full Monday-first 7 × 24 grid: missing cells are zero, duplicate
 * cells add up, and anything out of range or negative is dropped rather than drawn.
 */
export function toHeatmap(cells: readonly HeatCell[]): HeatmapView {
	const grid = WEEK_ORDER.map(() => new Array<number>(24).fill(0));
	for (const c of cells) {
		const row = WEEK_ORDER.indexOf(c.dow);
		if (row < 0 || !Number.isInteger(c.hour) || c.hour < 0 || c.hour > 23) continue;
		if (!Number.isFinite(c.value) || c.value <= 0) continue;
		grid[row][c.hour] += Math.round(c.value);
	}
	let total = 0;
	let peak: HeatmapView["peak"] = null;
	grid.forEach((hours, row) =>
		hours.forEach((value, hour) => {
			total += value;
			if (value > 0 && (!peak || value > peak.value)) {
				peak = { day: WEEKDAY[WEEK_ORDER[row]], hour: hourLabel(hour), value };
			}
		})
	);
	return {
		rows: WEEK_ORDER.map((d) => WEEKDAY[d]),
		columns: Array.from({ length: 24 }, (_, h) => hourLabel(h)),
		values: grid,
		total,
		peak,
	};
}
// #endregion

// #region Tables
/** One keyword row as the table prints it. */
export interface KeywordView {
	query: string;
	impressions: string;
	ctr: string;
	/** Whether the CTR cleared its threshold. */
	ctrSufficient: boolean;
}

/** The "Searches you appeared in" rows. */
export function toKeywords(rows: readonly KeywordRow[]): KeywordView[] {
	return rows.map((r) => ({
		query: r.query,
		impressions: countLabel(r.impressions),
		ctr: r.ctr === null ? "—" : percentLabel(r.ctr),
		ctrSufficient: r.ctr !== null,
	}));
}

/** Why a search could be missing from the keyword table. */
export const KEYWORD_NOTE =
	`A search is listed once at least ${KEYWORD_MIN_SESSIONS} different visitors made it, so no single buyer's searches can be picked out.`;

/** One top-listing row as the table prints it. */
export interface TopListingView {
	id: string;
	title: string;
	href: string;
	gross: string;
	orders: string;
	views: string;
	conversion: string;
}

/** The console's "Top listings", each linking to its own Analytics tab. */
export function toTopListings(
	rows: readonly TopListingRow[],
	hrefOf: (slug: string) => string,
): TopListingView[] {
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		href: hrefOf(r.id),
		gross: r.grossDisplay,
		orders: countLabel(r.orders),
		views: countLabel(r.views),
		conversion: r.conversion === null ? "—" : percentLabel(r.conversion),
	}));
}
// #endregion

// #region Caption
/** The window caption: "Through 13 Oct · updated nightly". */
export function asOfCaption(asOf: string): string {
	return `Through ${dayLabel(asOf)} · updated nightly`;
}

/** Whether the read sells booked time, which is when the booking heatmap belongs on the canvas. */
export function showsHeatmap(analytics: CatalogueAnalytics): boolean {
	return analytics.heatmap.length > 0;
}
// #endregion
