/**
 * kv.ts — the one shared Deno KV handle for the fat layer's cross-isolate caches.
 *
 * KV is an optimisation everywhere it is used, never a dependency: `Deno.openKv` is unstable-gated
 * (`--unstable-kv`, which `deno task serve` passes), may be refused by permissions, or may fail to
 * open. Every one of those is reported as `null`, and each caller degrades to its per-isolate memory
 * cache. The open is attempted once per isolate and memoised — success or failure — so a missing KV
 * never costs a syscall per request.
 */

import { ArcCache, READ_CACHE_MAX_ENTRIES } from "./cache.ts";

// #region Shared handle
/** The memoised open. `undefined` = not attempted yet; it then settles to a handle or `null`. */
let shared: Promise<Deno.Kv | null> | undefined;

/** Open Deno KV, tolerating every reason it might not exist. Resolves to `null`, never rejects. */
async function open(): Promise<Deno.Kv | null> {
	try {
		// `Deno.openKv` is unstable-gated; on a runtime without it the property is simply absent.
		const openKv = (Deno as { openKv?: () => Promise<Deno.Kv> }).openKv;
		return typeof openKv === "function" ? await openKv.call(Deno) : null;
	} catch {
		return null;
	}
}

/**
 * The isolate's shared Deno KV handle, or `null` when KV is unavailable here. Opened lazily on the
 * first call and memoised, so every caller shares one handle and one failed attempt. Never throws.
 */
export function openSharedKv(): Promise<Deno.Kv | null> {
	shared ??= open();
	return shared;
}
// #endregion

// #region Global values
/** A value as {@link cachedGlobal} holds it: wrapped, so `null`, `false`, `0` and `""` are hits. */
interface Held {
	value: unknown;
	expiresAt: number;
}

/** KV refuses a value over 64 KiB; a value past this stays in memory. */
const KV_VALUE_MAX_BYTES = 60 * 1024;

/**
 * The memory tier, bounded by ARC. Its own TTL is infinite because each entry carries its caller's
 * (`expiresAt`), which {@link cachedGlobal} checks before serving it.
 */
const globals = new ArcCache<Held>({
	maxEntries: READ_CACHE_MAX_ENTRIES,
	ttlMs: Number.POSITIVE_INFINITY,
});

let warnedOversize = false;

/** A KV key as a memory key: its JSON, a bigint part tagged so it cannot read as a number. */
function keyId(key: Deno.KvKey): string {
	return JSON.stringify(key, (_, part) => typeof part === "bigint" ? { bigint: `${part}` } : part);
}

/** Whether `held` may be written to KV. */
function fitsKv(held: Held): boolean {
	// shortcut: JSON size stands in for KV's V8 encoding with a 4 KiB margin, and a refused write
	// only costs other isolates a fetch; measure the real encoding if values near the limit appear.
	try {
		return new TextEncoder().encode(JSON.stringify(held)).byteLength <= KV_VALUE_MAX_BYTES;
	} catch {
		return false;
	}
}

/** The miss path: KV, then `fetch`. A KV hit fills memory for its remaining TTL. */
async function load(
	key: Deno.KvKey,
	ttlMs: number,
	fetch: () => Promise<unknown>,
): Promise<Held> {
	const kv = await openSharedKv();
	const stored = kv ? (await kv.get<Held>(key).catch(() => null))?.value : null;
	if (stored && stored.expiresAt > Date.now()) return stored;
	const held: Held = { value: await fetch(), expiresAt: Date.now() + ttlMs };
	if (kv && fitsKv(held)) {
		// Not awaited: the answer never waits on KV, and a failed write costs other isolates a fetch.
		kv.set(key, held, { expireIn: ttlMs }).catch(() => {});
	} else if (kv && !warnedOversize) {
		warnedOversize = true;
		console.warn("[cache:kv] a value over 60 KiB is served from memory only:", key);
	}
	return held;
}

/**
 * Read a small, global, PUBLIC value through memory → Deno KV → `fetch` (Decision #341, ruling E1
 * Q2): an FX table, a query's neighbour ids, reference data every viewer reads alike. Never a
 * tenant-scoped or RLS-scoped answer: every viewer and every isolate is served the one value under
 * `key`, so a viewer-scoped read belongs in an `ArcCache` under its tenant (`cache.ts`).
 *
 * A memory hit answers at once; a KV hit fills memory for its remaining TTL; a miss calls `fetch`
 * once per key however many callers wait (single-flight), answers, and writes KV without waiting.
 * `null`, `false`, `0` and `""` are values, not misses. A value over 60 KiB stays in memory only
 * (the first is logged). Without KV it is memory → `fetch`. A rejection of `fetch` reaches only
 * that flight's callers and is never stored. A version enters `key` through {@link cacheVersionTag}.
 */
export async function cachedGlobal<T>(
	key: Deno.KvKey,
	ttlMs: number,
	fetch: () => Promise<T>,
): Promise<T> {
	const id = keyId(key);
	const held = globals.get(id);
	if (held && held.expiresAt > Date.now()) return held.value as T;
	if (held) globals.delete(id);
	return (await globals.through(id, () => load(key, ttlMs, fetch))).value as T;
}
// #endregion

// #region Version keys
/**
 * Cross-isolate invalidation (Decision #339, ruling N2): the fat-service writer bumps a scope's
 * version in KV after its write commits, and readers fold the version into their cache keys. One
 * scope per global domain (`["catalogue"]`, `["fx"]`, `["reference"]`), one per affected tenant
 * where a write reaches other viewers (messaging: each participant's scope, which the writer knows).
 *
 * **How a version enters a cache key — always through {@link cacheVersionTag}:** a `v` param of an
 * `ArcCache` key (`cacheKey(tenant, ns, { ...params, v: await cacheVersionTag(scope) })`) or a part
 * of a {@link cachedGlobal} key. A bump changes the key, so each isolate misses on its next read
 * once its check lapses (at most a second), and the orphaned entry ages out under its own TTL.
 *
 * TTL is the guarantee, the version the optimisation: a write made outside the services (the SQL
 * console, a cron job), a lost bump and an isolate without KV are all covered by the TTL alone.
 */

/** How long an isolate trusts a version it read: at most one KV read per scope per second. */
const VERSION_CHECK_MS = 1_000;

/** Each scope's version as this isolate last read (or wrote) it. */
const versions = new ArcCache<string | null>({
	maxEntries: READ_CACHE_MAX_ENTRIES,
	ttlMs: VERSION_CHECK_MS,
});

/** The KV key holding a scope's version. */
function versionKey(scope: readonly string[]): Deno.KvKey {
	return ["cache", "v", ...scope];
}

/**
 * Bump `scope`'s version: a fresh random id under `["cache","v",...scope]`. Called by the writer
 * after its write commits. The writer's own isolate sees the new version at once; every other
 * isolate within {@link VERSION_CHECK_MS}. Without KV, or when the write fails, it does nothing (the
 * TTL backstops it). Resolves once written; never rejects.
 */
export async function bumpCacheVersion(scope: readonly string[]): Promise<void> {
	const kv = await openSharedKv();
	if (!kv) return;
	const version = crypto.randomUUID();
	const written = await kv.set(versionKey(scope), version).then(() => true, () => false);
	if (!written) return;
	const id = JSON.stringify(scope);
	versions.delete(id); // detaches a read from before the bump, so its answer cannot overwrite this
	versions.set(id, version);
}

/**
 * `scope`'s current version, read from KV at most once a second per isolate (concurrent reads share
 * one). `null` until the scope is first bumped, and always without KV or on a failed read, so the
 * TTL governs. Never rejects. To key a cache by it, use {@link cacheVersionTag}.
 */
export function cacheVersion(scope: readonly string[]): Promise<string | null> {
	return versions.through(JSON.stringify(scope), async () => {
		const kv = await openSharedKv();
		const entry = kv ? await kv.get<string>(versionKey(scope)).catch(() => null) : null;
		return entry?.value ?? null;
	});
}

/**
 * `scope`'s version as a cache-key component, valid in an `ArcCache` key and in a Deno KV key alike:
 * the version, or `"v0"` while there is none. The one way a version enters a key.
 */
export async function cacheVersionTag(scope: readonly string[]): Promise<string> {
	return (await cacheVersion(scope)) ?? "v0";
}
// #endregion

// #region Testing
/**
 * Swap the shared handle for `kv` (a stub, or `null` for no KV) and forget every cached value and
 * version; `undefined` restores the real open. Tests only.
 */
export function setSharedKvForTesting(kv: Deno.Kv | null | undefined): void {
	shared = kv === undefined ? undefined : Promise.resolve(kv);
	globals.clear();
	versions.clear();
}
// #endregion
