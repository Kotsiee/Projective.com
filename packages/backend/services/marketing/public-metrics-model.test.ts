import { assertEquals } from "@std/assert";
import {
	PUBLIC_METRICS_DEFAULT_MIN_N,
	type PublicMetricsAggregate,
	PublicMetricsAggregateSchema,
	PublicMetricsSchema,
} from "@projective/types/marketing";
import { PLATFORM_FEE_BP } from "@projective/types/finance";
import {
	aggregateWarnings,
	foldPublicMetrics,
	meetsThreshold,
	normaliseAsOf,
	planProtectedTotal,
	roundHours,
	sumConvertedParts,
	thresholdOf,
	totalCurrencyOf,
} from "./public-metrics-model.ts";
import { PUBLIC_METRICS_FIXTURE } from "./public-metrics-fixtures.ts";

/** An aggregate where every figure clears a threshold of 10. */
function rich(overrides: Partial<PublicMetricsAggregate> = {}): PublicMetricsAggregate {
	return {
		as_of: "2026-10-17T12:00:00.5+00:00",
		min_n: 10,
		min_n_configured: true,
		platform_fee_bp: 500,
		base_currency: "GBP",
		protected_count: 40,
		protected_by_currency: [{ currency: "GBP", amount_minor: 1_234_567 }],
		stages_delivered: 25,
		approval_count: 12,
		median_funding_to_approval_hours: 51.26,
		...overrides,
	};
}

const NOW = new Date("2026-10-17T13:00:00Z");

// #region Threshold
Deno.test("meetsThreshold: a count at or above the threshold passes; below, null or NaN does not", () => {
	assertEquals(meetsThreshold(10, 10), true);
	assertEquals(meetsThreshold(11, 10), true);
	assertEquals(meetsThreshold(9, 10), false);
	assertEquals(meetsThreshold(null, 10), false);
	assertEquals(meetsThreshold(undefined, 10), false);
	assertEquals(meetsThreshold(Number.NaN, 1), false);
});

Deno.test("thresholdOf: the aggregate's own threshold, else the default", () => {
	assertEquals(thresholdOf({ min_n: 25 }), 25);
	assertEquals(thresholdOf({ min_n: 0 }), PUBLIC_METRICS_DEFAULT_MIN_N);
	assertEquals(thresholdOf({ min_n: 2.5 }), PUBLIC_METRICS_DEFAULT_MIN_N);
});
// #endregion

// #region Value protected
Deno.test("planProtectedTotal: one currency is the exact, unconverted total", () => {
	assertEquals(planProtectedTotal(rich()), {
		kind: "single",
		total: { amountMinor: 1_234_567, currency: "GBP" },
	});
});

Deno.test("planProtectedTotal: below the threshold, or nothing to sum, is hidden", () => {
	assertEquals(planProtectedTotal(rich({ protected_count: 9 })), { kind: "hidden" });
	assertEquals(planProtectedTotal(rich({ protected_count: null })), { kind: "hidden" });
	assertEquals(planProtectedTotal(rich({ protected_by_currency: [] })), { kind: "hidden" });
	assertEquals(planProtectedTotal(rich({ protected_by_currency: null })), { kind: "hidden" });
});

Deno.test("planProtectedTotal: several currencies convert into the base, case-folded and merged", () => {
	const plan = planProtectedTotal(rich({
		base_currency: "eur",
		protected_by_currency: [
			{ currency: "usd", amount_minor: 100 },
			{ currency: "GBP", amount_minor: 50 },
			{ currency: "USD", amount_minor: 25 },
			{ currency: "", amount_minor: 999 },
		],
	}));
	assertEquals(plan, {
		kind: "convert",
		target: "EUR",
		parts: [{ currency: "GBP", minor: 50 }, { currency: "USD", minor: 125 }],
	});
});

Deno.test("totalCurrencyOf: the base_currency param, else the platform base", () => {
	assertEquals(totalCurrencyOf({ base_currency: "usd" }), "USD");
	assertEquals(totalCurrencyOf({ base_currency: null }), "GBP");
	assertEquals(totalCurrencyOf({ base_currency: "pounds" }), "GBP");
});

Deno.test("sumConvertedParts: sums only when every part reached the target", () => {
	const converted = [
		{ minor: 50, currency: "GBP", converted: false, origin: { currency: "GBP" } },
		{ minor: 98, currency: "GBP", converted: true, origin: { currency: "USD" } },
	];
	assertEquals(sumConvertedParts("GBP", converted), { amountMinor: 148, currency: "GBP" });
	// A currency with no rate comes back unconverted, in its own currency: the total is withheld.
	assertEquals(
		sumConvertedParts("GBP", [
			...converted,
			{ minor: 7, currency: "XAF", converted: false, origin: { currency: "XAF" } },
		]),
		null,
	);
	assertEquals(sumConvertedParts("GBP", []), null);
});
// #endregion

// #region Fold
Deno.test("foldPublicMetrics: every figure that clears the threshold is published, median to 0.1h", () => {
	const aggregate = rich();
	const out = foldPublicMetrics(aggregate, planTotal(aggregate), NOW);
	assertEquals(out, {
		asOf: "2026-10-17T12:00:00.500Z",
		minN: 10,
		platformFeeBp: 500,
		totalValueProtected: { amountMinor: 1_234_567, currency: "GBP" },
		stagesDelivered: 25,
		medianFundingToApprovalHours: 51.3,
	});
	assertEquals(PublicMetricsSchema.safeParse(out).success, true);
});

Deno.test("foldPublicMetrics: re-holds each figure to the threshold even if the database did not", () => {
	const aggregate = rich({ min_n: 30 });
	const out = foldPublicMetrics(aggregate, { amountMinor: 1, currency: "GBP" }, NOW);
	assertEquals(out.totalValueProtected, { amountMinor: 1, currency: "GBP" });
	assertEquals(out.stagesDelivered, null);
	assertEquals(out.medianFundingToApprovalHours, null);
	const thin = foldPublicMetrics(rich({ protected_count: 3 }), {
		amountMinor: 1,
		currency: "GBP",
	}, NOW);
	assertEquals(thin.totalValueProtected, null);
});

Deno.test("foldPublicMetrics: a missing fee falls back to the display constant; a bad timestamp to now", () => {
	const out = foldPublicMetrics(rich({ platform_fee_bp: null, as_of: "not a date" }), null, NOW);
	assertEquals(out.platformFeeBp, PLATFORM_FEE_BP);
	assertEquals(out.asOf, NOW.toISOString());
});

Deno.test("the frozen fixture parses and, at the default threshold, publishes only the fee", () => {
	const aggregate = PublicMetricsAggregateSchema.parse(PUBLIC_METRICS_FIXTURE);
	const out = foldPublicMetrics(aggregate, planTotal(aggregate), NOW);
	assertEquals(out, {
		asOf: "2026-10-17T21:07:08.982Z",
		minN: PUBLIC_METRICS_DEFAULT_MIN_N,
		platformFeeBp: 500,
		totalValueProtected: null,
		stagesDelivered: null,
		medianFundingToApprovalHours: null,
	});
	// With the threshold the transaction used (1), the same raw figures would all show.
	const lifted = foldPublicMetrics(
		{ ...aggregate, min_n: 1 },
		planTotal({
			...aggregate,
			min_n: 1,
		}),
		NOW,
	);
	assertEquals(lifted.totalValueProtected, { amountMinor: 15_100_000, currency: "USD" });
	assertEquals(lifted.stagesDelivered, 2);
	assertEquals(lifted.medianFundingToApprovalHours, 396);
});

Deno.test("roundHours / normaliseAsOf", () => {
	assertEquals(roundHours(395.999978254167), 396);
	assertEquals(roundHours(0.04), 0);
	assertEquals(roundHours(12.35), 12.4);
	assertEquals(normaliseAsOf("2026-10-17T21:07:08+01:00", NOW), "2026-10-17T20:07:08.000Z");
});

Deno.test("aggregateWarnings: names each fallback a live answer depends on", () => {
	assertEquals(aggregateWarnings(rich()), []);
	const warnings = aggregateWarnings(rich({ min_n_configured: false, platform_fee_bp: null }));
	assertEquals(warnings.length, 2);
	assertEquals(warnings[0].includes("public_metrics_min_n"), true);
	assertEquals(warnings[1].includes("platform_fee_bp"), true);
});
// #endregion

/** The single-currency total of an aggregate, as the service resolves it before the fold. */
function planTotal(aggregate: PublicMetricsAggregate) {
	const plan = planProtectedTotal(aggregate);
	return plan.kind === "single" ? plan.total : null;
}
