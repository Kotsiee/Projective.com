import { assertEquals } from "@std/assert";
import type { PublicMetricsAggregate } from "@projective/types/marketing";
import { ArcCache } from "../../core/cache.ts";
import { createPublicMetricsService, type PublicMetricsDeps } from "./PublicMetricsService.ts";
import type { ConvertedPart, MoneyPart } from "./public-metrics-model.ts";

/**
 * PublicMetricsService — the read path's contract with injected dependencies: no database, no FX
 * table, no clock. The rules themselves are pinned in `public-metrics-model.test.ts`.
 */

function aggregate(overrides: Partial<PublicMetricsAggregate> = {}): PublicMetricsAggregate {
	return {
		as_of: "2026-10-17T12:00:00+00:00",
		min_n: 10,
		min_n_configured: true,
		platform_fee_bp: 500,
		base_currency: "GBP",
		protected_count: 30,
		protected_by_currency: [{ currency: "GBP", amount_minor: 900_000 }],
		stages_delivered: 12,
		approval_count: 11,
		median_funding_to_approval_hours: 40,
		...overrides,
	};
}

interface Harness {
	deps: Partial<PublicMetricsDeps>;
	reads: () => number;
	warnings: string[];
}

function harness(read: () => Promise<unknown>, extra: Partial<PublicMetricsDeps> = {}): Harness {
	let reads = 0;
	const warnings: string[] = [];
	return {
		reads: () => reads,
		warnings,
		deps: {
			live: () => true,
			readAggregate: () => {
				reads++;
				return read();
			},
			now: () => new Date("2026-10-17T13:00:00Z"),
			warn: (m) => warnings.push(m),
			cache: new ArcCache<unknown>({ maxEntries: 4, ttlMs: 60_000 }),
			convert: () => Promise.reject(new Error("no conversion expected")),
			...extra,
		},
	};
}

Deno.test("get: a live read is folded, validated and cached — the second call does not read", async () => {
	const h = harness(() => Promise.resolve(aggregate()));
	const service = createPublicMetricsService(h.deps);
	const first = await service.get();
	assertEquals(first.ok, true);
	assertEquals(first.status, 200);
	assertEquals(first.data?.totalValueProtected, { amountMinor: 900_000, currency: "GBP" });
	assertEquals(first.data?.stagesDelivered, 12);
	const second = await service.get();
	assertEquals(second.data, first.data);
	assertEquals(h.reads(), 1);
	service.invalidate();
	await service.get();
	assertEquals(h.reads(), 2);
});

Deno.test("get: a database error is a 503, logged and never cached", async () => {
	const h = harness(() => Promise.reject(new Error("connection refused")));
	const service = createPublicMetricsService(h.deps);
	const result = await service.get();
	assertEquals(result.ok, false);
	assertEquals(result.status, 503);
	assertEquals(h.warnings, ["connection refused"]);
	await service.get();
	assertEquals(h.reads(), 2);
});

Deno.test("get: a drifted function answer is a 502, not a guess", async () => {
	const h = harness(() => Promise.resolve({ as_of: "now", min_n: "ten" }));
	const result = await createPublicMetricsService(h.deps).get();
	assertEquals(result.status, 502);
	assertEquals(h.warnings.length, 1);
});

Deno.test("get: an absent threshold row still answers (default 10) and is logged", async () => {
	const h = harness(() => Promise.resolve(aggregate({ min_n_configured: false })));
	const result = await createPublicMetricsService(h.deps).get();
	assertEquals(result.ok, true);
	assertEquals(result.data?.minN, 10);
	assertEquals(h.warnings.some((w) => w.includes("public_metrics_min_n")), true);
});

Deno.test("get: several currencies convert into the base and sum; one unconvertible withholds", async () => {
	const several = aggregate({
		protected_by_currency: [
			{ currency: "GBP", amount_minor: 1000 },
			{ currency: "USD", amount_minor: 1270 },
		],
	});
	const convert = (parts: readonly MoneyPart[], target: string): Promise<ConvertedPart[]> =>
		Promise.resolve(
			parts.map((p) =>
				p.currency === target
					? { minor: p.minor, currency: target, converted: false, origin: { currency: p.currency } }
					: {
						minor: Math.round(p.minor / 1.27),
						currency: target,
						converted: true,
						origin: { currency: p.currency },
					}
			),
		);
	const ok = harness(() => Promise.resolve(several), { convert });
	const result = await createPublicMetricsService(ok.deps).get();
	assertEquals(result.data?.totalValueProtected, { amountMinor: 2000, currency: "GBP" });

	const noRate = (parts: readonly MoneyPart[]): Promise<ConvertedPart[]> =>
		Promise.resolve(parts.map((p) => ({
			minor: p.minor,
			currency: p.currency,
			converted: false,
			origin: { currency: p.currency },
		})));
	const missing = harness(() => Promise.resolve(several), { convert: noRate });
	const withheld = await createPublicMetricsService(missing.deps).get();
	assertEquals(withheld.ok, true);
	assertEquals(withheld.data?.totalValueProtected, null);
	assertEquals(missing.warnings.some((w) => w.includes("USD")), true);
});

Deno.test("get: the gate off serves the frozen fixture, with no read and no warning", async () => {
	const h = harness(() => Promise.reject(new Error("must not read")), { live: () => false });
	const result = await createPublicMetricsService(h.deps).get();
	assertEquals(result.ok, true);
	assertEquals(result.data?.platformFeeBp, 500);
	assertEquals(result.data?.totalValueProtected, null);
	assertEquals(h.reads(), 0);
	assertEquals(h.warnings, []);
});
