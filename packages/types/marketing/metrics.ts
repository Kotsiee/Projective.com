import { z } from "zod";

/**
 * The public site's live platform metrics (Decision #277) — the figures `/about` and the landing
 * page's "live numbers" section print, served by `PublicMetricsService` and `GET /api/public/metrics`.
 *
 * Every figure is a real server-side aggregate over the whole platform, never row-level data, and
 * never padded: a figure whose underlying count is below the platform's threshold
 * (`security.platform_params.public_metrics_min_n`, {@link PUBLIC_METRICS_DEFAULT_MIN_N} when the
 * row is absent) is `null`, and a surface hides its tile.
 */

// #region Constants
/**
 * The threshold the service applies when `public_metrics_min_n` is missing or malformed. Mirrored by
 * the literal fallback in `finance.public_metrics()` (00001265) — the two must agree.
 */
export const PUBLIC_METRICS_DEFAULT_MIN_N = 10;

/** How long a computed answer is served from memory before the aggregate is read again (1 hour). */
export const PUBLIC_METRICS_TTL_MS = 60 * 60 * 1000;

/**
 * The escrow statuses whose principal counts as "value protected": money placed in escrow that has
 * not been handed back. `funded` / `held` are locked, `disputed` is locked under a dispute, and
 * `released` reached its payee. `refunded` is excluded — refunded money can be escrowed again, and
 * counting both would count it twice. Mirrored by `finance.public_metrics()`.
 */
export const PROTECTED_ESCROW_STATUSES = ["funded", "held", "disputed", "released"] as const;

/** The stage statuses that count as "delivered". Mirrored by `finance.public_metrics()`. */
export const DELIVERED_STAGE_STATUSES = ["approved", "paid"] as const;
// #endregion

// #region Public payload
/** A money total in one currency, in that currency's minor units. */
export const PublicMoneyTotalSchema = z.object({
	amountMinor: z.number().int().nonnegative(),
	/** ISO-4217, upper case. */
	currency: z.string().regex(/^[A-Z]{3}$/),
});
export type PublicMoneyTotal = z.infer<typeof PublicMoneyTotalSchema>;

/**
 * What `PublicMetricsService.get()` answers and `GET /api/public/metrics` returns (inside the flat
 * `{ ok, … }` envelope every thin route uses). `null` means "below the threshold — hide the tile".
 */
export const PublicMetricsSchema = z.object({
	/** When the aggregate was computed (ISO 8601, UTC). */
	asOf: z.iso.datetime({ offset: true }),
	/** The threshold every nullable figure below was held to. */
	minN: z.number().int().positive(),
	/** The platform service fee in basis points (`platform_fee_bp`; 500 = 5%). Always present. */
	platformFeeBp: z.number().int().min(0).max(10_000),
	/** Escrowed principal (held + released, all time), in one currency — see Decision #277. */
	totalValueProtected: PublicMoneyTotalSchema.nullable(),
	/** Stages approved and paid out, all time. */
	stagesDelivered: z.number().int().nonnegative().nullable(),
	/** Median hours from a delivered stage's first funding to its approval. */
	medianFundingToApprovalHours: z.number().nonnegative().nullable(),
});
export type PublicMetrics = z.infer<typeof PublicMetricsSchema>;
// #endregion

// #region Database aggregate
/** One currency's share of the protected total, as `finance.public_metrics()` emits it. */
export const PublicMetricsCurrencyRowSchema = z.object({
	currency: z.string().min(1),
	amount_minor: z.number().int().nonnegative(),
});
export type PublicMetricsCurrencyRow = z.infer<typeof PublicMetricsCurrencyRowSchema>;

/**
 * The jsonb `finance.public_metrics()` returns (00001265). The database applies the threshold
 * itself, so a count below `min_n` arrives as `null` together with the figure it would have
 * produced — no figure resting on fewer than `min_n` rows ever leaves Postgres. `min_n_configured`
 * is `false` when the param row was missing or malformed and the literal default was used.
 * `platform_fee_bp` and `base_currency` are `null` when their param rows are missing or malformed.
 */
export const PublicMetricsAggregateSchema = z.object({
	as_of: z.string().min(1),
	min_n: z.number().int().positive(),
	min_n_configured: z.boolean(),
	platform_fee_bp: z.number().int().min(0).max(10_000).nullable(),
	base_currency: z.string().nullable(),
	protected_count: z.number().int().nonnegative().nullable(),
	protected_by_currency: z.array(PublicMetricsCurrencyRowSchema).nullable(),
	stages_delivered: z.number().int().nonnegative().nullable(),
	approval_count: z.number().int().nonnegative().nullable(),
	median_funding_to_approval_hours: z.number().nonnegative().nullable(),
});
export type PublicMetricsAggregate = z.infer<typeof PublicMetricsAggregateSchema>;
// #endregion
