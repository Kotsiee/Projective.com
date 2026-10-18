import {
	PUBLIC_METRICS_TTL_MS,
	type PublicMetrics,
	type PublicMetricsAggregate,
	PublicMetricsAggregateSchema,
	PublicMetricsSchema,
	type PublicMoneyTotal,
} from "@projective/types/marketing";
import { ArcCache, cacheKey, type CacheTenant } from "../../core/cache.ts";
import { getServiceClient, isFinanceBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { FxService } from "../finance/FxService.ts";
import { PUBLIC_METRICS_FIXTURE } from "./public-metrics-fixtures.ts";
import {
	aggregateWarnings,
	type ConvertedPart,
	foldPublicMetrics,
	type MoneyPart,
	planProtectedTotal,
	sumConvertedParts,
} from "./public-metrics-model.ts";

/**
 * PublicMetricsService — the public site's live platform figures (Decision #277): money protected
 * in escrow, stages delivered, the median time from funding to approval and the platform fee, for
 * `/about` and the landing page's live numbers.
 *
 * ## Where the figures come from
 *
 * One SECURITY DEFINER aggregate, `finance.public_metrics()` (00001265), called with the service
 * role — the only role granted it. It returns aggregates only and applies the publication threshold
 * itself, so a figure resting on fewer than `public_metrics_min_n` rows never leaves Postgres; the
 * fold here holds every figure to the same threshold again. No row of any table is read here.
 * With `FINANCE_BACKEND_LIVE` off the same fold runs over {@link PUBLIC_METRICS_FIXTURE}, an
 * aggregate frozen from the seeded database.
 *
 * ## Currencies
 *
 * Escrow is stored in the currency each stage was priced in. One currency → the exact total, never
 * converted. Several → each converted into the platform base (the `base_currency` param) at the
 * newest reference rate in `finance.fx_rates`, through {@link FxService} — the product's read-time
 * display rule (finance-model.md §11) — and summed; if any currency cannot be converted the total
 * is withheld rather than understated.
 *
 * ## Caching
 *
 * One hour, through an {@link ArcCache} of its own, keyed to the ANONYMOUS tenant: the answer is
 * the same for every visitor, so there is no per-caller scope to leak. A failure is never cached.
 */

// #region Dependencies
/** What the service reaches for — injectable so the rules are tested without a database. */
export interface PublicMetricsDeps {
	/** Whether to read the database (`isFinanceBackendLive`). */
	live(): boolean;
	/** Call `finance.public_metrics()`; resolves to the RPC's `data`, rejects on any error. */
	readAggregate(): Promise<unknown>;
	/** The fixture aggregate for the gate-off path. */
	fixture(): PublicMetricsAggregate;
	/** Convert minor amounts into one currency (`FxService.convertMany`). */
	convert(parts: readonly MoneyPart[], target: string): Promise<ConvertedPart[]>;
	now(): Date;
	/** Where a fallback or a failure is reported. */
	warn(message: string): void;
	/** The cache the answer is held in. */
	cache: ArcCache<unknown>;
}

/** The tenant every public-metrics key is scoped to: the anonymous one (the answer is public). */
export const PUBLIC_METRICS_TENANT: CacheTenant = Object.freeze({ userId: "", contextId: "" });

/** The cache namespace. */
const NAMESPACE = "marketing.public-metrics";

async function readLiveAggregate(): Promise<unknown> {
	const { data, error } = await getServiceClient().schema("finance").rpc("public_metrics");
	if (error) {
		throw new Error(`finance.public_metrics failed — ${error.code ?? ""} ${error.message}`);
	}
	return data;
}

const DEFAULT_DEPS: PublicMetricsDeps = {
	live: isFinanceBackendLive,
	readAggregate: readLiveAggregate,
	fixture: () => PUBLIC_METRICS_FIXTURE,
	convert: (parts, target) => FxService.convertMany(parts, target),
	now: () => new Date(),
	warn: (message) => console.warn(`[public-metrics] ${message}`),
	cache: new ArcCache<unknown>({ maxEntries: 4, ttlMs: PUBLIC_METRICS_TTL_MS }),
};
// #endregion

// #region Service
/** The service surface: one read, and an eviction for tests and an operator refresh hook. */
export interface PublicMetricsReader {
	/** The current public figures; cached for an hour. */
	get(): Promise<ServiceResult<PublicMetrics>>;
	/** Drop the cached answer so the next `get()` reads the aggregate again. */
	invalidate(): void;
}

/** Resolve the protected total for an aggregate (exact, converted, or withheld). */
async function protectedTotal(
	aggregate: PublicMetricsAggregate,
	deps: PublicMetricsDeps,
): Promise<PublicMoneyTotal | null> {
	const plan = planProtectedTotal(aggregate);
	if (plan.kind === "hidden") return null;
	if (plan.kind === "single") return plan.total;
	const converted = await deps.convert(plan.parts, plan.target);
	const total = sumConvertedParts(plan.target, converted);
	if (total === null) {
		const missing = converted
			.filter((part) => !part.converted && part.origin.currency.toUpperCase() !== plan.target)
			.map((part) => part.origin.currency)
			.join(", ");
		deps.warn(
			`no reference rate into ${plan.target} for ${missing || "a currency"}; ` +
				"the value-protected total is withheld",
		);
	}
	return total;
}

/** Build a {@link PublicMetricsReader} over `deps` (the default instance is {@link PublicMetricsService}). */
export function createPublicMetricsService(
	overrides: Partial<PublicMetricsDeps> = {},
): PublicMetricsReader {
	const deps: PublicMetricsDeps = { ...DEFAULT_DEPS, ...overrides };

	const keyFor = (source: "live" | "fixture") =>
		cacheKey(PUBLIC_METRICS_TENANT, NAMESPACE, { source });

	return {
		async get(): Promise<ServiceResult<PublicMetrics>> {
			const live = deps.live();
			const key = keyFor(live ? "live" : "fixture");
			const hit = deps.cache.get(key) as PublicMetrics | undefined;
			if (hit) return ok(hit);

			let raw: unknown;
			if (live) {
				try {
					raw = await deps.readAggregate();
				} catch (error) {
					deps.warn(error instanceof Error ? error.message : String(error));
					return fail(503, { message: "Live figures are unavailable right now." });
				}
			} else {
				raw = deps.fixture();
			}

			const parsed = PublicMetricsAggregateSchema.safeParse(raw);
			if (!parsed.success) {
				deps.warn(
					`finance.public_metrics answered an unexpected shape: ${
						parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join(
							"; ",
						)
					}`,
				);
				return fail(502, { message: "Live figures are unavailable right now." });
			}
			const aggregate = parsed.data;
			if (live) { for (const warning of aggregateWarnings(aggregate)) deps.warn(warning); }

			const total = await protectedTotal(aggregate, deps);
			const folded = PublicMetricsSchema.safeParse(foldPublicMetrics(aggregate, total, deps.now()));
			if (!folded.success) {
				deps.warn(`the folded figures failed their schema: ${folded.error.message}`);
				return fail(500, { message: "Live figures are unavailable right now." });
			}
			deps.cache.set(key, folded.data);
			return ok(folded.data);
		},
		invalidate(): void {
			deps.cache.clear();
		},
	};
}

/**
 * The public figures, cached for an hour — `PublicMetricsService.get()`.
 *
 * @example
 * ```ts
 * const result = await PublicMetricsService.get();
 * if (result.ok) render(result.data.totalValueProtected); // null → hide the tile
 * ```
 */
export const PublicMetricsService: PublicMetricsReader = createPublicMetricsService();
// #endregion
