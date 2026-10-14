import { z } from "zod";
import { AnalyticsPeriod } from "./catalogue.ts";
import { ConsoleScope } from "./url.ts";

/**
 * catalogue.analytics — the read model behind the console's Analytics view and the workspace's
 * Analytics tab (plan §4.7).
 *
 * Aggregates only, never a buyer-level trail (Decision #217(k)). Two thresholds keep a sparse
 * catalogue from printing a misleading figure: a rate needs {@link RATE_MIN_DENOMINATOR} in its
 * denominator, and a search keyword needs {@link KEYWORD_MIN_SESSIONS} distinct sessions before it
 * is shown at all. Below either, the tile says there is not enough data rather than printing 0%.
 */

// #region Thresholds
/** The smallest denominator a rate is shown from (CTR, conversion, churn). */
export const RATE_MIN_DENOMINATOR = 20;
/** The fewest distinct sessions a search keyword must come from to be listed. */
export const KEYWORD_MIN_SESSIONS = 5;

/** `n / d`, or `null` when the denominator is too small to say anything. */
export function rateOrNull(n: number, d: number): number | null {
	if (!Number.isFinite(n) || !Number.isFinite(d) || d < RATE_MIN_DENOMINATOR) return null;
	return n / d;
}
// #endregion

// #region Scope
/** What one analytics read covers: the whole (filtered) catalogue, or one listing. */
export const AnalyticsScope = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("catalogue"), filter: ConsoleScope }),
	z.object({ kind: z.literal("listing"), listingId: z.string().min(1).max(120) }),
]);
export type AnalyticsScope = z.infer<typeof AnalyticsScope>;
// #endregion

// #region Tiles
/** The figures the stat-tile row reports. */
export const MetricKey = z.enum([
	"impressions",
	"views",
	"ctr",
	"checkout_starts",
	"orders",
	"gross",
	"conversion",
	"churn",
	"standing_impact",
]);
export type MetricKey = z.infer<typeof MetricKey>;

/** A figure's change against the previous window of the same length. */
export const MetricDeltaSchema = z.object({
	/** Signed percentage change. */
	change: z.number(),
	/** Carried separately so the arrow glyph, not colour alone, states the direction. */
	direction: z.enum(["up", "down", "flat"]),
});
export type MetricDelta = z.infer<typeof MetricDeltaSchema>;

/** One unboxed stat tile. */
export const MetricTileSchema = z.object({
	key: MetricKey,
	/** The tile's name ("Impressions"). */
	label: z.string().max(40),
	/** The raw figure; `null` when it is not {@link sufficient}. */
	value: z.number().nullable(),
	/** The pre-formatted figure ("3.4%", "$4,820"), identical on the server and the client. */
	display: z.string().max(32),
	/** `null` when there is no previous window to compare with. */
	delta: MetricDeltaSchema.nullable(),
	/** Whether the data behind the figure clears its threshold. */
	sufficient: z.boolean(),
});
export type MetricTile = z.infer<typeof MetricTileSchema>;
// #endregion

// #region Series, funnel, heatmap, keywords
/** One day of a series (`YYYY-MM-DD`, the seller's timezone). */
export const SeriesPointSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	value: z.number(),
});
export type SeriesPoint = z.infer<typeof SeriesPointSchema>;

/** One step of the impressions → views → checkout → orders funnel. */
export const FunnelStepSchema = z.object({
	key: z.enum(["impressions", "views", "checkout_starts", "orders"]),
	label: z.string().max(40),
	count: z.number().int().min(0),
	/** Share of the previous step that reached this one; `null` for the first step or a small base. */
	rate: z.number().min(0).nullable(),
});
export type FunnelStep = z.infer<typeof FunnelStepSchema>;

/** Booked session starts in one weekday-hour cell (0 = Sunday, the seller's timezone). */
export const HeatCellSchema = z.object({
	dow: z.number().int().min(0).max(6),
	hour: z.number().int().min(0).max(23),
	value: z.number().int().min(0),
});
export type HeatCell = z.infer<typeof HeatCellSchema>;

/** One search query the listing was shown for. Only queries from enough sessions are listed. */
export const KeywordRowSchema = z.object({
	/** The normalised query. */
	query: z.string().min(1).max(120),
	impressions: z.number().int().min(0),
	sessions: z.number().int().min(KEYWORD_MIN_SESSIONS),
	clicks: z.number().int().min(0),
	ctr: z.number().min(0).nullable(),
});
export type KeywordRow = z.infer<typeof KeywordRowSchema>;
// #endregion

// #region Read model
/** Everything one analytics canvas renders, for one scope and window. */
export const CatalogueAnalyticsSchema = z.object({
	scope: AnalyticsScope,
	period: AnalyticsPeriod,
	/** The currency gross figures are in. */
	currency: z.string().regex(/^[A-Z]{3}$/),
	/** The IANA timezone days and heatmap hours are bucketed in. */
	timezone: z.string().max(64),
	tiles: z.array(MetricTileSchema).max(12),
	/** Daily gross across the window, oldest first. */
	revenue: z.array(SeriesPointSchema).max(366),
	funnel: z.array(FunnelStepSchema).max(4),
	/** Empty unless the scope sells sessions. */
	heatmap: z.array(HeatCellSchema).max(168),
	keywords: z.array(KeywordRowSchema).max(50),
	/** ISO timestamp the rollups were last computed. */
	asOf: z.string(),
});
export type CatalogueAnalytics = z.infer<typeof CatalogueAnalyticsSchema>;
// #endregion
