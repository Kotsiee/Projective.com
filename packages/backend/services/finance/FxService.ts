import {
	type ConvertedAmount,
	convertMinorUnits,
	currencyExponent,
	FX_RATE_MAX_AGE_HOURS,
	type FxQuote,
	type FxRateTable,
	type FxRecordAnswer,
	type FxRefreshResult,
	PLATFORM_BASE_CURRENCY,
	resolveRate,
	toDisplayCurrency,
} from "@projective/types/finance";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { serverEnv } from "../../core/env.ts";
import { openSharedKv } from "../../core/kv.ts";
import { getAnonClient, isSupabaseConfigured, useMocks } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	checkFxFeed,
	configuredFxFeed,
	type FxFeedAdapter,
	FxFeedError,
	type FxRecordCall,
	type FxRecordDoor,
	liveFxRecordDoor,
} from "./fx-feed.ts";

/**
 * FxService — the FAT currency-conversion engine. The **only** thing on the platform that turns one
 * currency into another, so there is exactly one rate table, one rounding rule, and one answer.
 *
 * ## What it is not
 *
 * It is not a settlement engine. Converting here is a **read-time projection**: it never writes, and
 * nothing it returns is authoritative for money that has already moved. A committed transaction or
 * escrow carries its own `(fx_rate, fx_base, fx_as_of)` snapshot, and a statement or invoice reprints
 * THAT — never a rate resolved today. Everything below exists so a viewer can read a figure in their
 * own currency, and for no other purpose.
 *
 * ## Caching
 *
 * Rates are cached per base for {@link CACHE_TTL_MS} (15 minutes) in **Deno KV**, so every isolate
 * serving the app shares one warm table instead of each re-reading `finance.fx_rates`. KV is opened
 * lazily and its absence is not an error: an environment without `--unstable-kv`, without the
 * permission, or with a read failure falls through to a per-isolate in-memory cache with the same
 * TTL. The two layers are checked in that order and written in both, so behaviour degrades from
 * "shared cache" to "local cache" to "read every time" without any caller noticing.
 *
 * ## Failing
 *
 * No method here throws and no method returns "no answer". A failed read yields a table that knows
 * only its own base, and every pair against it is unresolvable — so, like any unresolvable pair, it
 * returns the **origin amount unchanged** with `converted: false`. That is the load-bearing choice:
 * the alternative — assuming a rate of 1, or relabelling an amount with a symbol it was not priced in
 * — turns a missing number into a WRONG one, which is the only FX failure a reader cannot detect. A
 * failed read is never cached, so the next request tries the database again.
 *
 * ## The source
 *
 * `finance.fx_rates`, read as `anon`: the rates are public reference data (the policy is `USING
 * (true)` for `anon` and `authenticated`), and SSR converts a price for a signed-out visitor exactly
 * as for a signed-in one. The migrations seed a floor for every offerable currency, so a fresh
 * database always has an answer; the daily feed's observations land beside it and win by `as_of`.
 *
 * ## The feed
 *
 * {@link FxService.refreshRates} is the one writer besides the seed (Decision #337, ruling M5 (f);
 * Decision #471; FBP DB17): the `finance-fx-daily` job fetches the provider's rates, checks them, and
 * records them all through `finance.record_fx_rates`, or none. A refused or failed feed leaves the last
 * rates standing, so they age past {@link STALE_AFTER_MS} into the stale mark, the same window the
 * conversion quote refuses them after.
 */

// #region Cache
/** How long a resolved rate table is considered current. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * How old a table may be before figures derived from it are disclosed as stale: the same
 * {@link FX_RATE_MAX_AGE_HOURS} after which `finance.quote_fx_conversion` refuses a rate.
 */
const STALE_AFTER_MS = FX_RATE_MAX_AGE_HOURS * 60 * 60 * 1000;

/** The KV key prefix for a cached table, namespaced so it cannot collide with another domain's. */
const KV_PREFIX = ["finance", "fx", "table"] as const;

/** A cached table plus the wall-clock instant it was resolved at. */
interface CacheEntry {
	table: FxRateTable;
	cachedAt: number;
}

/** Per-isolate fallback cache, used whenever Deno KV is unavailable. */
const memoryCache = new Map<string, CacheEntry>();

/** Whether a cache entry is still inside the TTL. */
function fresh(entry: CacheEntry, now: number): boolean {
	return now - entry.cachedAt < CACHE_TTL_MS;
}

/** Read a cached table for `base` from KV, then memory. Returns `null` on a miss or any failure. */
async function readCache(base: string, now: number): Promise<FxRateTable | null> {
	const kv = await openSharedKv();
	if (kv) {
		try {
			const hit = await kv.get<CacheEntry>([...KV_PREFIX, base]);
			if (hit.value && fresh(hit.value, now)) return hit.value.table;
		} catch {
			// A KV read failure is a cache miss, never an error surfaced to the caller.
		}
	}
	const local = memoryCache.get(base);
	return local && fresh(local, now) ? local.table : null;
}

/** Write a resolved table to both cache layers. Never throws. */
async function writeCache(base: string, table: FxRateTable, now: number): Promise<void> {
	const entry: CacheEntry = { table, cachedAt: now };
	memoryCache.set(base, entry);
	const kv = await openSharedKv();
	if (!kv) return;
	try {
		await kv.set([...KV_PREFIX, base], entry, { expireIn: CACHE_TTL_MS });
	} catch {
		// Memory cache already holds it; a KV write failure costs freshness across isolates, not
		// correctness.
	}
}
// #endregion

// #region Table assembly
/** One row shape as read from `finance.fx_rates`. */
interface FxRow {
	base: string;
	quote: string;
	rate: number | string;
	as_of: string;
	provider: string;
}

/** Whether a table's newest observation is old enough to disclose. */
function isStale(asOf: string, now: number): boolean {
	const observed = Date.parse(asOf);
	return Number.isNaN(observed) ? true : now - observed > STALE_AFTER_MS;
}

/**
 * The table to answer with when the database could not be read: it knows only its own base, so every
 * pair against it is unresolvable and every amount stays in the currency it was priced in. Never
 * cached, and disclosed as stale.
 */
function unavailableTable(base: string, now: number): FxRateTable {
	return {
		base,
		rates: { [base]: 1 },
		asOf: new Date(now).toISOString(),
		provider: "unavailable",
		stale: true,
	};
}

/**
 * Re-quote a table from its own base into `target`, through one pivot.
 *
 * The rates are observed against the platform base. For any other base the whole table is re-quoted
 * once, here, rather than making every caller triangulate — one division per pair, done in a single
 * place, so a re-based table and a natively-based one round identically. A target the table does not
 * quote cannot be re-based honestly, so it gets the table that knows only itself.
 */
function rebase(table: FxRateTable, target: string, now: number): FxRateTable {
	if (target === table.base) return table;
	const pivot = table.rates[target];
	if (typeof pivot !== "number" || pivot <= 0) return unavailableTable(target, now);
	const rates: Record<string, number> = {};
	for (const [code, rate] of Object.entries(table.rates)) rates[code] = rate / pivot;
	rates[target] = 1;
	return { ...table, base: target, rates };
}

/**
 * Read the newest observation per quote against the PLATFORM base from `finance.fx_rates`.
 *
 * Read as `anon`: the rates are public reference data, and SSR reads them for signed-out visitors
 * too. Returns `null` — never throws — on any failure.
 */
async function readLiveTable(now: number): Promise<FxRateTable | null> {
	const base = PLATFORM_BASE_CURRENCY;
	try {
		const { data, error } = await getAnonClient()
			.schema("finance")
			.from("fx_rates")
			.select("base,quote,rate,as_of,provider")
			.eq("base", base)
			.order("as_of", { ascending: false })
			.limit(500);

		if (error || !Array.isArray(data) || data.length === 0) return null;

		// Rows arrive newest-first, so the FIRST row for a quote is its current rate; later rows are
		// history and are skipped. `newest` tracks the table's own as_of — the newest observation in it.
		const rates: Record<string, number> = {};
		let newest = "";
		let provider = "";
		for (const row of data as FxRow[]) {
			const quote = String(row.quote ?? "").toUpperCase();
			if (!quote || quote in rates) continue;
			const rate = typeof row.rate === "number" ? row.rate : Number.parseFloat(String(row.rate));
			if (!Number.isFinite(rate) || rate <= 0) continue;
			rates[quote] = rate;
			if (!newest || row.as_of > newest) {
				newest = row.as_of;
				provider = row.provider;
			}
		}
		if (Object.keys(rates).length === 0) return null;
		rates[base] = 1;

		return {
			base,
			rates,
			asOf: newest,
			provider: provider || "unknown",
			stale: isStale(newest, now),
		};
	} catch {
		return null;
	}
}
// #endregion

// #region The daily feed
/** What one run of the feed reads and writes through; each defaults to the live one. */
export interface FxRefreshDeps {
	/** The provider. Omitted: {@link configuredFxFeed}; `null`: none is configured. */
	feed?: FxFeedAdapter | null;
	/** Where the feed is recorded. Omitted: `finance.record_fx_rates` as the service role. */
	record?: FxRecordDoor;
	/** The clock an `as_of` is judged against. */
	now?: () => number;
}

/**
 * The call a run makes of the door — the feed if it passed, or the refusal found first — and the
 * currencies that refusal names.
 */
async function feedCall(
	feed: FxFeedAdapter | null,
	now: number,
): Promise<{ call: FxRecordCall; named: string[] }> {
	if (!feed) {
		return {
			call: { provider: "none", asOf: null, rates: null, failure: "feed_not_configured" },
			named: [],
		};
	}
	try {
		const snapshot = await feed.fetchLatest();
		const check = checkFxFeed(snapshot, now);
		return {
			call: {
				provider: snapshot.provider,
				asOf: Number.isNaN(Date.parse(snapshot.asOf)) ? null : snapshot.asOf,
				rates: snapshot.rates,
				failure: check.ok ? null : check.reason,
			},
			named: check.ok ? [] : check.currencies,
		};
	} catch (error) {
		const failure = error instanceof FxFeedError ? error.code : "fetch_failed";
		console.error(
			"[fx-feed:fetch]",
			failure,
			error instanceof Error ? error.message : String(error),
		);
		return { call: { provider: feed.provider, asOf: null, rates: null, failure }, named: [] };
	}
}

/** The run's outcome from the door's answer; a refusal names the door's currencies, else the check's. */
function refreshResult(answer: FxRecordAnswer, named: readonly string[]): FxRefreshResult {
	if (answer.refused) {
		return {
			recorded: 0,
			provider: answer.provider,
			asOf: answer.as_of,
			outcome: "refused",
			reason: answer.refused,
			currencies: answer.currencies?.length ? answer.currencies : [...named],
		};
	}
	return {
		recorded: answer.recorded,
		provider: answer.provider,
		asOf: answer.as_of,
		outcome: answer.recorded > 0 ? "recorded" : "replay",
		reason: null,
		currencies: [],
	};
}
// #endregion

export class FxService {
	/**
	 * The current rate table for `base` (defaults to the platform base), cached for 15 minutes.
	 *
	 * Total: a read that fails yields a table that converts nothing rather than an error, so a caller
	 * never has to branch on "did FX work" — only on whether an individual pair resolved. That table is
	 * not cached: a database that comes back is read on the very next request.
	 */
	static async rates(base: string = PLATFORM_BASE_CURRENCY): Promise<FxRateTable> {
		const code = (base || PLATFORM_BASE_CURRENCY).toUpperCase();
		const now = Date.now();

		const cached = await readCache(code, now);
		if (cached) return cached;

		const live = isSupabaseConfigured() ? await readLiveTable(now) : null;
		if (!live) return unavailableTable(code, now);

		const table = rebase(live, code, now);
		await writeCache(code, table, now);
		return table;
	}

	/**
	 * The multiplier from `from` into `to`, with the observation instant it was quoted at.
	 *
	 * `null` when the pair cannot be resolved from the table. Callers must treat that as "leave the
	 * amount alone" — see the class doc on why an assumed rate is worse than no rate.
	 */
	static async quote(from: string, to: string): Promise<FxQuote | null> {
		const src = (from || "").toUpperCase();
		const dst = (to || "").toUpperCase();
		if (!src || !dst) return null;

		const table = await FxService.rates(PLATFORM_BASE_CURRENCY);
		const rate = resolveRate(table, src, dst);
		if (rate === null) return null;

		return {
			base: src,
			quote: dst,
			rate,
			asOf: table.asOf,
			provider: table.provider,
			stale: table.stale,
		};
	}

	/**
	 * Convert `amountMinor` from `originCurrency` into `targetCurrency`, returning both the converted
	 * value and the exact FX snapshot instant (`asOf`) it was computed at — the two facts a surface
	 * needs to render an honest cross-currency figure, and the two an invoice needs to reproduce one.
	 *
	 * Exponent-aware (¥1000 and £10.00 are both "1000 minor units" and must not be conflated) and
	 * rounded exactly once, at the end, so a long ledger cannot accumulate a rounding drift.
	 */
	static async convertAmount(
		amountMinor: number,
		originCurrency: string,
		targetCurrency: string,
	): Promise<ConvertedAmount> {
		const origin = {
			minor: Math.trunc(amountMinor),
			currency: (originCurrency || PLATFORM_BASE_CURRENCY).toUpperCase(),
		};
		const target = (targetCurrency || origin.currency).toUpperCase();

		const table = await FxService.rates(PLATFORM_BASE_CURRENCY);
		const identity = origin.currency === target;
		const rate = identity ? 1 : resolveRate(table, origin.currency, target);

		// Unresolvable pair → hand back the origin untouched. Never a fabricated rate, never a
		// relabelled amount.
		if (rate === null) {
			return {
				minor: origin.minor,
				currency: origin.currency,
				origin,
				rate: 1,
				asOf: table.asOf,
				provider: table.provider,
				converted: false,
				stale: table.stale,
			};
		}

		const minor = identity ? origin.minor : convertMinorUnits(
			origin.minor,
			rate,
			currencyExponent(origin.currency),
			currencyExponent(target),
		);

		return {
			minor,
			currency: target,
			origin,
			rate,
			asOf: table.asOf,
			provider: table.provider,
			converted: !identity,
			stale: table.stale,
		};
	}

	/**
	 * Convert many amounts sharing one target in a single pass. Resolves the table ONCE, so a page
	 * rendering forty figures does forty multiplications rather than forty cache reads.
	 */
	static async convertMany(
		amounts: ReadonlyArray<{ minor: number; currency: string }>,
		targetCurrency: string,
	): Promise<ConvertedAmount[]> {
		if (amounts.length === 0) return [];
		// Warm the shared table before the loop; each `convertAmount` below then hits the cache.
		await FxService.rates(PLATFORM_BASE_CURRENCY);
		const out: ConvertedAmount[] = [];
		for (const amount of amounts) {
			out.push(await FxService.convertAmount(amount.minor, amount.currency, targetCurrency));
		}
		return out;
	}

	/**
	 * Narrow an arbitrary code to a currency this engine can actually price. Re-exported from the
	 * SSOT so a caller reaching for the service does not have to know which module owns the list.
	 */
	static supportedCurrency(code: string | null | undefined): string {
		return toDisplayCurrency(code);
	}

	/**
	 * Whether a scheduler's `Authorization: Bearer …` header carries `FINANCE_CRON_SECRET` (≥ 32
	 * characters; unset or short authorises nothing), compared in constant time.
	 */
	static isCronAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().financeCronSecret);
	}

	/**
	 * One run of the daily feed: fetch the provider's rates, check them ({@link checkFxFeed}), then
	 * record them through `finance.record_fx_rates`, all twelve or none. The door applies the checks
	 * again and is the authority; a refusal found here is passed to it, so it logs the `finance.fx`
	 * error and records nothing. A run with no configured feed records nothing and is logged the same
	 * way (`feed_not_configured`). New rates drop the cached tables, so the next read sees them.
	 *
	 * 200 whenever the door answered, with what it did (`recorded`, `replay` or `refused`); 503 when the
	 * database cannot be written in this environment or the door could not be reached.
	 */
	static async refreshRates(deps: FxRefreshDeps = {}): Promise<ServiceResult<FxRefreshResult>> {
		if (!deps.record && (useMocks() || !isSupabaseConfigured())) {
			return fail(503, { message: "Exchange rates can't be recorded in this environment." });
		}
		const record = deps.record ?? liveFxRecordDoor;
		const feed = deps.feed === undefined ? configuredFxFeed() : deps.feed;
		const { call, named } = await feedCall(feed, (deps.now ?? Date.now)());
		let answer: FxRecordAnswer;
		try {
			answer = await record(call);
		} catch (error) {
			console.error("[fx-feed:record]", error instanceof Error ? error.message : String(error));
			return fail(503, { message: "The exchange rates could not be recorded. Try again later." });
		}
		if (answer.recorded > 0) await FxService.invalidate();
		return ok(refreshResult(answer, named));
	}

	/** Drop every cached table. For tests and for an operational rate-refresh hook. */
	static async invalidate(): Promise<void> {
		memoryCache.clear();
		const kv = await openSharedKv();
		if (!kv) return;
		try {
			for await (const entry of kv.list({ prefix: [...KV_PREFIX] })) await kv.delete(entry.key);
		} catch {
			// The memory cache is already cleared; a KV failure only delays cross-isolate refresh.
		}
	}
}
