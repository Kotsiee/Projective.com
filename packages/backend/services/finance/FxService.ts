import {
	type ConvertedAmount,
	convertMinorUnits,
	currencyExponent,
	type FxQuote,
	type FxRateTable,
	PLATFORM_BASE_CURRENCY,
	resolveRate,
	toDisplayCurrency,
} from "@projective/types/finance";
import {
	getServiceClient,
	isFinanceBackendLive,
	isSupabaseConfigured,
} from "../../core/supabase.ts";
import {
	FX_FIXTURE_AS_OF,
	FX_FIXTURE_BASE,
	FX_FIXTURE_PROVIDER,
	FX_FIXTURE_RATES,
} from "./fx-fixtures.ts";

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
 * No method here throws and no method returns "no answer". A failed live read degrades to the seeded
 * fixture table; an unresolvable pair returns the **origin amount unchanged** with `converted:
 * false`. That last one is the load-bearing choice: the alternative — assuming a rate of 1, or
 * relabelling an amount with a symbol it was not priced in — turns a missing number into a WRONG
 * one, which is the only FX failure a reader cannot detect.
 */

// #region Cache
/** How long a resolved rate table is considered current. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** How old a table may be before figures derived from it are disclosed as stale. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The KV key prefix for a cached table, namespaced so it cannot collide with another domain's. */
const KV_PREFIX = ["finance", "fx", "table"] as const;

/** A cached table plus the wall-clock instant it was resolved at. */
interface CacheEntry {
	table: FxRateTable;
	cachedAt: number;
}

/** Per-isolate fallback cache, used whenever Deno KV is unavailable. */
const memoryCache = new Map<string, CacheEntry>();

/**
 * The lazily-opened KV handle. `undefined` = not attempted yet; `null` = attempted and unavailable
 * (so we never retry an open that already failed, which would cost a syscall on every request).
 */
let kvHandle: Deno.Kv | null | undefined;

/** Open Deno KV once, tolerating every reason it might not exist. Never throws. */
async function openKv(): Promise<Deno.Kv | null> {
	if (kvHandle !== undefined) return kvHandle;
	try {
		// `Deno.openKv` is unstable-gated; on a runtime without it the property is simply absent.
		const open = (Deno as { openKv?: () => Promise<Deno.Kv> }).openKv;
		kvHandle = typeof open === "function" ? await open.call(Deno) : null;
	} catch {
		kvHandle = null;
	}
	return kvHandle;
}

/** Whether a cache entry is still inside the TTL. */
function fresh(entry: CacheEntry, now: number): boolean {
	return now - entry.cachedAt < CACHE_TTL_MS;
}

/** Read a cached table for `base` from KV, then memory. Returns `null` on a miss or any failure. */
async function readCache(base: string, now: number): Promise<FxRateTable | null> {
	const kv = await openKv();
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
	const kv = await openKv();
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

/** The seeded fixture table for a base — the stub answer and the live path's failure floor. */
function fixtureTable(base: string, now: number): FxRateTable {
	const target = base.toUpperCase();
	const rates: Record<string, number> = { ...FX_FIXTURE_RATES };

	// The fixtures are quoted against the platform base. For any other base, re-quote the whole table
	// through it once here rather than making every caller triangulate — one division per pair, done
	// in a single place, so a re-based table and a natively-based one round identically.
	if (target !== FX_FIXTURE_BASE) {
		const pivot = FX_FIXTURE_RATES[target];
		if (typeof pivot === "number" && pivot > 0) {
			for (const [code, rate] of Object.entries(FX_FIXTURE_RATES)) rates[code] = rate / pivot;
		}
	}
	rates[target] = 1;

	return {
		base: target,
		rates,
		asOf: FX_FIXTURE_AS_OF,
		provider: FX_FIXTURE_PROVIDER,
		stale: isStale(FX_FIXTURE_AS_OF, now),
	};
}

/**
 * Read the newest observation per quote for `base` from `finance.fx_rates`.
 *
 * Uses the service-role client deliberately: FX rates are public reference data (the RLS policy is
 * `USING (true)` for `authenticated`), but this read happens in SSR for signed-out visitors too, and
 * an anonymous viewer must still see prices in their chosen currency. Returns `null` — never throws —
 * on any failure, so the caller falls back to the fixture floor.
 */
async function readLiveTable(base: string, now: number): Promise<FxRateTable | null> {
	try {
		const { data, error } = await getServiceClient()
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
			asOf: newest || FX_FIXTURE_AS_OF,
			provider: provider || "unknown",
			stale: isStale(newest, now),
		};
	} catch {
		return null;
	}
}
// #endregion

export class FxService {
	/**
	 * The current rate table for `base` (defaults to the platform base), cached for 15 minutes.
	 *
	 * Total: a live read that fails, returns nothing, or is gated off yields the seeded fixture table
	 * rather than an error, so a caller never has to branch on "did FX work" — only on whether an
	 * individual pair resolved.
	 */
	static async rates(base: string = PLATFORM_BASE_CURRENCY): Promise<FxRateTable> {
		const code = (base || PLATFORM_BASE_CURRENCY).toUpperCase();
		const now = Date.now();

		const cached = await readCache(code, now);
		if (cached) return cached;

		const table =
			(isFinanceBackendLive() && isSupabaseConfigured() ? await readLiveTable(code, now) : null) ??
				fixtureTable(code, now);

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

	/** Drop every cached table. For tests and for an operational rate-refresh hook. */
	static async invalidate(): Promise<void> {
		memoryCache.clear();
		const kv = await openKv();
		if (!kv) return;
		try {
			for await (const entry of kv.list({ prefix: [...KV_PREFIX] })) await kv.delete(entry.key);
		} catch {
			// The memory cache is already cleared; a KV failure only delays cross-isolate refresh.
		}
	}
}
