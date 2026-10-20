/**
 * metrics-sim — the development-only "The numbers so far" simulation (`flows/LANDING.md` §6,
 * the `landingMetrics` axis of the Dev Context Switcher; root CLAUDE.md §5).
 *
 * Which of the section's figures show is decided by the DATABASE: `finance.public_metrics()` holds
 * every figure to the `public_metrics_min_n` threshold, and the development seed clears none of
 * them, so on the seed the section is always omitted and no tile can be seen. The Dev Context
 * Switcher writes this cookie instead, and the landing route honours it only in a development build:
 * `hidden` withholds all three figures (the omitted section), `shown` fills each with a sample
 * figure (every tile). The fee is never touched — it is a parameter, not a thresholded figure — and
 * a failed read stays failed: the simulation forces the threshold's result, never the read's.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`; the route gates it.
 */
import type { PublicMetrics } from "@projective/types/marketing";

// #region Contract
/** The cookie the Dev Context Switcher writes and `/` reads in development. */
export const LANDING_METRICS_SIM_COOKIE = "pj.dev.landing-metrics";

/** A simulated threshold result: every figure withheld, or every figure shown. */
export type LandingMetricsSim = "hidden" | "shown";

/**
 * The sample figures `shown` prints: one unconverted total (so its tile renders), a count and a
 * median. Development only; never a real reading.
 */
export const LANDING_METRICS_SAMPLE: Pick<
	PublicMetrics,
	"totalValueProtected" | "stagesDelivered" | "medianFundingToApprovalHours"
> = {
	totalValueProtected: { amountMinor: 15_000_000, currency: "GBP", converted: false },
	stagesDelivered: 120,
	medianFundingToApprovalHours: 46,
};
// #endregion

// #region Codec
/** Read a cookie value back; anything unrecognised is ignored rather than trusted (`null`). */
export function parseLandingMetricsSim(raw: string | null | undefined): LandingMetricsSim | null {
	const value = raw?.trim();
	return value === "hidden" || value === "shown" ? value : null;
}

/**
 * Lay a simulation over the metrics read. No simulation, or a failed read (`null`), passes through
 * untouched; `hidden` nulls the three figures; `shown` replaces them with
 * {@link LANDING_METRICS_SAMPLE}. `asOf`, `minN` and the fee are always the read's own.
 */
export function applyLandingMetricsSim(
	metrics: PublicMetrics | null,
	sim: LandingMetricsSim | null,
): PublicMetrics | null {
	if (!metrics || !sim) return metrics;
	if (sim === "shown") return { ...metrics, ...LANDING_METRICS_SAMPLE };
	return {
		...metrics,
		totalValueProtected: null,
		stagesDelivered: null,
		medianFundingToApprovalHours: null,
	};
}
// #endregion
