import {
	PUBLIC_METRICS_DEFAULT_MIN_N,
	type PublicMetrics,
	type PublicMetricsAggregate,
	type PublicMoneyTotal,
	type PublicProtectedTotal,
} from "@projective/types/marketing";
import {
	currencyExponent,
	PLATFORM_BASE_CURRENCY,
	PLATFORM_FEE_BP,
} from "@projective/types/finance";

/**
 * public-metrics-model — the pure rules between `finance.public_metrics()`'s aggregate and the
 * {@link PublicMetrics} the public site prints (Decision #277). No I/O: the service reads, converts
 * and caches; this module decides what may be shown and how one total is made from several
 * currencies, so every rule here is unit-tested without a database.
 */

// #region Threshold
/**
 * Whether a figure resting on `count` rows may be published under threshold `minN`. A `null` count
 * is the database saying it already withheld the figure.
 */
export function meetsThreshold(count: number | null | undefined, minN: number): boolean {
	return typeof count === "number" && Number.isFinite(count) && count >= minN;
}

/**
 * The threshold to hold every figure to: the aggregate's own (the database already fell back to 10
 * when the param row was unusable), else {@link PUBLIC_METRICS_DEFAULT_MIN_N}.
 */
export function thresholdOf(aggregate: Pick<PublicMetricsAggregate, "min_n">): number {
	return Number.isInteger(aggregate.min_n) && aggregate.min_n >= 1
		? aggregate.min_n
		: PUBLIC_METRICS_DEFAULT_MIN_N;
}
// #endregion

// #region Value protected
/** One currency's protected principal, in its minor units. */
export interface MoneyPart {
	minor: number;
	currency: string;
}

/**
 * How the protected total is to be produced:
 *  - `hidden` — below the threshold, nothing to sum, or a row whose currency is not a three-letter
 *    code (`malformed` names them, for the service to log): dropping that row would understate the
 *    total, and a public total is withheld rather than understated;
 *  - `single` — every protected escrow is in one currency, so the total is exact and unconverted;
 *  - `convert` — several currencies, each to be converted into `target` (the platform base) at the
 *    read-time reference rate and summed. Stored amounts are never summed across currencies as if
 *    they were one (finance-model.md §11).
 */
export type ProtectedTotalPlan =
	| { kind: "hidden"; malformed?: readonly string[] }
	| { kind: "single"; total: PublicMoneyTotal }
	| { kind: "convert"; target: string; parts: MoneyPart[] };

/** The base currency to convert a multi-currency total into: the param, else the platform base. */
export function totalCurrencyOf(aggregate: Pick<PublicMetricsAggregate, "base_currency">): string {
	const code = aggregate.base_currency?.trim().toUpperCase() ?? "";
	return /^[A-Z]{3}$/.test(code) ? code : PLATFORM_BASE_CURRENCY;
}

/**
 * Plan the protected total. Currency codes are folded to upper case and a code's parts merged, so
 * `usd` and `USD` rows (the database groups by `upper()` already) can never become two currencies.
 */
export function planProtectedTotal(aggregate: PublicMetricsAggregate): ProtectedTotalPlan {
	const minN = thresholdOf(aggregate);
	if (!meetsThreshold(aggregate.protected_count, minN)) return { kind: "hidden" };
	const merged = new Map<string, number>();
	const malformed: string[] = [];
	for (const row of aggregate.protected_by_currency ?? []) {
		if (row.amount_minor <= 0) continue;
		const code = row.currency.trim().toUpperCase();
		if (!/^[A-Z]{3}$/.test(code)) {
			malformed.push(row.currency);
			continue;
		}
		merged.set(code, (merged.get(code) ?? 0) + row.amount_minor);
	}
	if (malformed.length > 0) return { kind: "hidden", malformed };
	const parts = [...merged.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([currency, minor]) => ({ currency, minor }));
	if (parts.length === 0) return { kind: "hidden" };
	if (parts.length === 1) {
		return { kind: "single", total: { amountMinor: parts[0].minor, currency: parts[0].currency } };
	}
	return { kind: "convert", target: totalCurrencyOf(aggregate), parts };
}

/** One part after the FX engine has seen it (the shape `FxService.convertMany` answers with). */
export interface ConvertedPart {
	minor: number;
	currency: string;
	/** `false` when the pair could not be resolved and the amount came back in its origin currency. */
	converted: boolean;
	origin: { currency: string };
}

/**
 * Sum converted parts into one total in `target`, or `null` when ANY part could not be converted:
 * leaving a currency out would understate the figure and relabelling it would overstate it, and a
 * public total may do neither. A part already in `target` counts as converted (identity).
 */
export function sumConvertedParts(
	target: string,
	parts: readonly ConvertedPart[],
): PublicMoneyTotal | null {
	if (parts.length === 0) return null;
	let sum = 0;
	for (const part of parts) {
		const identity = part.origin.currency.toUpperCase() === target;
		if (!(part.converted || identity) || part.currency.toUpperCase() !== target) return null;
		if (!Number.isFinite(part.minor) || part.minor < 0) return null;
		sum += Math.trunc(part.minor);
	}
	return { amountMinor: sum, currency: target };
}

/** How many significant figures of whole major units a published total keeps. */
export const PUBLISHED_TOTAL_SIGNIFICANT_FIGURES = 2;

/**
 * Coarsen a total before it is published: whole major units floored to
 * {@link PUBLISHED_TOTAL_SIGNIFICANT_FIGURES} significant figures (`$151,000.00` → `$150,000`,
 * `£12,345.67` → `£12,000`), then back to minor units, so the shape stays `amountMinor: int`.
 *
 * The threshold keeps one escrow's amount out of a single read; this keeps it out of the
 * DIFFERENCE of two hourly reads, which would otherwise give an escrow funded or refunded between
 * them to the minor unit. The step is 1–10% of the total, so a change is seen only in whole steps
 * and grows coarser as the platform grows. Floored, never rounded: a public total may understate,
 * never overstate. `null` when less than one whole unit is left — too small to mean anything.
 */
export function coarsenPublishedTotal<T extends PublicMoneyTotal>(total: T): T | null {
	const unit = 10 ** currencyExponent(total.currency);
	const major = Math.floor(Math.max(0, total.amountMinor) / unit);
	if (major < 1) return null;
	// The digit count from the integer's own text: `Math.log10` is not exact at every power of ten.
	const digits = String(major).length;
	const step = 10 ** Math.max(0, digits - PUBLISHED_TOTAL_SIGNIFICANT_FIGURES);
	return { ...total, amountMinor: Math.floor(major / step) * step * unit };
}
// #endregion

// #region Fold
/** Round hours to one decimal place — the precision the public figure is stated at. */
export function roundHours(hours: number): number {
	return Math.round(hours * 10) / 10;
}

/** The aggregate's timestamp as UTC ISO 8601, or `fallback` when it does not parse. */
export function normaliseAsOf(raw: string, fallback: Date): string {
	const at = new Date(raw);
	return Number.isNaN(at.getTime()) ? fallback.toISOString() : at.toISOString();
}

/**
 * Fold the database aggregate and the already-resolved protected total into the public payload.
 * Every nullable figure is re-held to the threshold here even though the database applied it too,
 * so a fixture or a drifted function cannot publish a figure the rule forbids, and the total is
 * coarsened ({@link coarsenPublishedTotal}) — the only form in which it is ever published — with
 * its `converted` marker carried through unchanged.
 */
export function foldPublicMetrics(
	aggregate: PublicMetricsAggregate,
	totalValueProtected: PublicProtectedTotal | null,
	now: Date,
): PublicMetrics {
	const minN = thresholdOf(aggregate);
	const median = aggregate.median_funding_to_approval_hours;
	return {
		asOf: normaliseAsOf(aggregate.as_of, now),
		minN,
		platformFeeBp: aggregate.platform_fee_bp ?? PLATFORM_FEE_BP,
		totalValueProtected: meetsThreshold(aggregate.protected_count, minN) && totalValueProtected
			? coarsenPublishedTotal(totalValueProtected)
			: null,
		stagesDelivered: meetsThreshold(aggregate.stages_delivered, minN)
			? aggregate.stages_delivered
			: null,
		medianFundingToApprovalHours:
			meetsThreshold(aggregate.approval_count, minN) && typeof median === "number" &&
				Number.isFinite(median)
				? roundHours(median)
				: null,
	};
}

/**
 * What the service should log about an aggregate read LIVE: each fallback the answer depends on.
 * A fixture read reports nothing — it has no param rows by construction.
 */
export function aggregateWarnings(aggregate: PublicMetricsAggregate): string[] {
	const out: string[] = [];
	if (!aggregate.min_n_configured) {
		out.push(
			`security.platform_params.public_metrics_min_n is missing or not a number >= 1; ` +
				`the default threshold ${thresholdOf(aggregate)} was applied`,
		);
	}
	if (aggregate.platform_fee_bp === null) {
		out.push(
			`security.platform_params.platform_fee_bp is missing or malformed; ` +
				`showing the ${PLATFORM_FEE_BP} bp display fallback`,
		);
	}
	return out;
}
// #endregion
