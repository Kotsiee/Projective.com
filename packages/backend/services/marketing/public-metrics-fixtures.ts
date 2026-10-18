import {
	PUBLIC_METRICS_DEFAULT_MIN_N,
	type PublicMetricsAggregate,
} from "@projective/types/marketing";

/**
 * The aggregate `PublicMetricsService` serves while `FINANCE_BACKEND_LIVE` is off — real figures,
 * not invented ones (Decision #277).
 *
 * HOW IT WAS MADE. Computed on 2026-10-17 at 21:07 UTC against the seeded shared local database
 * (`deno task db:reset` seed: 8 escrows — 5 held, 3 released, all USD — and 2 paid stages) by running
 * the body of `finance.public_metrics()` (00001265) inside a transaction that was ROLLED BACK, with
 * `public_metrics_min_n` lifted to 1 for that transaction only so the raw figures came out instead
 * of the NULLs the default threshold produces. Nothing was written.
 *
 * WHAT IT SHOWS. The raw figures are kept and the threshold is restored to the default the service
 * applies when no param row can be read ({@link PUBLIC_METRICS_DEFAULT_MIN_N}, `min_n_configured:
 * false`), so the fold hides every figure resting on fewer than 10 rows — exactly what the database
 * itself answers on the same seed. On the development seed, then, only the platform fee is shown,
 * and that is the honest answer. Re-freeze it the same way if the seed's money changes.
 */
export const PUBLIC_METRICS_FIXTURE: PublicMetricsAggregate = Object.freeze({
	as_of: "2026-10-17T21:07:08.982062+00:00",
	min_n: PUBLIC_METRICS_DEFAULT_MIN_N,
	min_n_configured: false,
	platform_fee_bp: 500,
	base_currency: "GBP",
	protected_count: 8,
	protected_by_currency: [{ currency: "USD", amount_minor: 15_100_000 }],
	stages_delivered: 2,
	approval_count: 2,
	median_funding_to_approval_hours: 395.999978254167,
});
