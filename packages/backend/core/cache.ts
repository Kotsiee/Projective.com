/**
 * cache.ts — the fat layer's bounded, tenant-scoped, in-memory read cache.
 *
 * ## Why ARC rather than LRU
 *
 * The read endpoints this backs have two access shapes at once, and a plain LRU serves exactly one
 * of them. A chat feed or a submissions tree is scanned — a long tail of cursor pages, each touched
 * once — while a project's detail projection, its channel list and its member roster are touched on
 * every navigation within that project. Under LRU the scan evicts the working set: paging through
 * four hundred files flushes the detail row that every one of those pages was rendered beside, and
 * the next click re-reads it from Postgres.
 *
 * ARC (Megiddo & Modha) keeps two lists — {@link ArcCache} `t1` for entries seen ONCE and `t2` for
 * entries seen AGAIN — and two *ghost* lists of keys recently evicted from each (`b1`, `b2`). A hit
 * in a ghost list is the signal that the eviction was a mistake, and the target size `p` moves
 * toward whichever list is being missed. A scan therefore lands in `t1` and evicts itself, leaving
 * `t2` intact; a genuinely hot key is promoted to `t2` on its second touch and stops competing with
 * the scan at all. It is self-tuning, so nothing here needs a hand-set recency/frequency ratio that
 * would be wrong for half the endpoints.
 *
 * ## Bounded, in both dimensions
 *
 * `maxEntries` bounds the resident set; `ttlMs` bounds staleness. Both are required — a TTL-only
 * cache is unbounded in memory, and an entries-only cache serves a deleted ticket forever. Ghost
 * lists hold KEYS ONLY (never values), so the metadata cost of remembering a bad eviction is a
 * string rather than a page of JSON, and the total resident value count never exceeds `maxEntries`.
 *
 * ## The tenant rule, enforced by the type system
 *
 * Every entry is keyed by the caller's identity, and {@link cacheKey} cannot be called without one:
 * the {@link CacheTenant} parameter is required and non-optional, so there is no overload that
 * produces a global key by omission. This is deliberate and load-bearing. Every read behind this
 * cache runs under RLS as a specific user, so two callers asking the identical question are asking
 * two different questions — the rows they may see differ. A key that omitted the tenant would let
 * the first caller's answer be served to the second, which is a cross-tenant disclosure that RLS
 * cannot catch because the query is never issued. Tenant identity is a PREFIX rather than a hashed
 * component so the leading bytes of a key are readable in a dump and a mistake is visible.
 *
 * ## What must never be cached here
 *
 * Anything a mutation invalidates within the TTL and cannot tolerate being stale, and anything
 * derived from a token that outlives it. This cache has no cross-process invalidation — it is
 * per-isolate — so {@link ArcCache.delete} and {@link ArcCache.clearTenant} bound one process only.
 * Treat the TTL as the real guarantee and invalidation as an optimisation, never the reverse.
 */

// #region Keys

/**
 * The identity a cache key is scoped to.
 *
 * Both fields are required. `contextId` is the entity the caller is ACTING AS (a team, business or
 * organisation), which is a distinct cache dimension from `userId`: the same person switching
 * context sees a different feed, and collapsing the two would serve their personal projects into
 * their team's lane. An empty string is a legitimate value for `contextId` (a personal context) and
 * is preserved verbatim rather than dropped, so "personal" and "team X" cannot collide.
 */
export interface CacheTenant {
	/** The signed-in user's id. `""` for an anonymous caller — a real, distinct tenant. */
	userId: string;
	/** The entity being acted as; `""` in a personal context. */
	contextId: string;
}

/**
 * Serialise a value to a STABLE string — the same logical value always yields the same text.
 *
 * Object keys are sorted, because `{a,b}` and `{b,a}` are one query and must not be two entries.
 * Array order is PRESERVED, because it is semantic everywhere it appears in these params (a sort
 * order, a cursor path, a facet list the UI renders in order) and sorting it would merge two
 * genuinely different requests. `undefined` members are dropped so an explicitly-absent optional
 * matches an omitted one; `null` is kept, since in this codebase it is a real value (`channelId:
 * null` means project scope, distinct from "not specified").
 */
function stableStringify(value: unknown): string {
	if (value === null) return "null";
	if (typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

	// Values whose data lives in INTERNAL SLOTS rather than in own properties. `Object.entries` on a
	// Date, a Map or a Set returns `[]`, so without these branches every one of them serialises to
	// `{}` — and two requests differing only in such a value share a cache entry. A date-ranged read
	// (`{from, to}`) would collapse to ONE key and serve January's rows to June's request for the
	// whole TTL. Nothing routed through this cache passes one today; the point is that the failure
	// would be silent, tenant-correct, and impossible to spot from a call site.
	if (value instanceof Date) {
		// `getTime()` rather than `toISOString()`: an Invalid Date throws on the latter.
		return `Date(${value.getTime()})`;
	}
	if (value instanceof Map) {
		const pairs = [...value.entries()]
			.map(([k, v]) => `${stableStringify(k)}:${stableStringify(v)}`)
			.sort();
		return `Map{${pairs.join(",")}}`;
	}
	if (value instanceof Set) {
		return `Set{${[...value].map(stableStringify).sort().join(",")}}`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Build a deterministic cache key from the tenant, a namespace, and the request's parameters.
 *
 * The namespace is the endpoint identity (`"projects.detail"`), which keeps two endpoints that
 * happen to take the same params — `files` and `submissions` both take `{projectId, channelId}` —
 * from sharing an entry. The tenant leads so that {@link ArcCache.clearTenant} can match on a
 * prefix, and so a key is legible at a glance.
 *
 * The separator is `\u0000`, a byte that cannot occur in a JSON-serialised key or in any id this
 * system mints, so no combination of user id and namespace can be made to collide by choosing a
 * value that contains the delimiter.
 */
export function cacheKey(tenant: CacheTenant, namespace: string, params?: unknown): string {
	const scope = `${tenant.userId}\u0000${tenant.contextId}`;
	const tail = params === undefined ? "" : `\u0000${stableStringify(params)}`;
	return `${scope}\u0000${namespace}${tail}`;
}

/** The prefix every key for one tenant begins with — the unit {@link ArcCache.clearTenant} matches. */
export function tenantPrefix(tenant: CacheTenant): string {
	return `${tenant.userId}\u0000${tenant.contextId}\u0000`;
}

// #endregion

// #region Cache

/** A resident entry: the cached value and the wall-clock instant it was stored at. */
interface Entry<V> {
	value: V;
	storedAt: number;
}

/** Tuning for one {@link ArcCache} instance. */
export interface ArcCacheOptions {
	/**
	 * Maximum RESIDENT entries (`t1` + `t2`). Ghost lists add at most `maxEntries` more KEYS, so the
	 * worst-case bookkeeping is `2 × maxEntries` strings and exactly `maxEntries` values.
	 */
	maxEntries: number;
	/** How long an entry may be served before it is treated as a miss. */
	ttlMs: number;
	/** Injectable clock, for tests. Defaults to `Date.now`. */
	now?: () => number;
}

/** Point-in-time counters, for a diagnostics endpoint or a test assertion. */
export interface CacheStats {
	hits: number;
	misses: number;
	/** Misses that hit a GHOST list — evictions this cache now believes were premature. */
	ghostHits: number;
	evictions: number;
	/** Misses caused by an entry being past its TTL rather than absent. */
	expirations: number;
	/** Resident entries (`t1` + `t2`). */
	size: number;
	/** Current adaptive target size for `t1`. */
	p: number;
}

/**
 * An Adaptive Replacement Cache.
 *
 * The four lists are `Map`s used as LRU queues: JavaScript `Map` preserves insertion order, so
 * "move to most-recently-used" is `delete` then `set`, and "least-recently-used" is the first key
 * the iterator yields. Both are O(1) amortised, which is what keeps the policy's bookkeeping off
 * the critical path of a request.
 *
 * Not thread-safe and does not need to be: a Deno isolate runs one JavaScript thread, and every
 * method here is synchronous, so no interleaving is possible between a read and the promotion it
 * performs.
 */
export class ArcCache<V> {
	/** Recent: keys seen exactly once. Values resident. */
	#t1 = new Map<string, Entry<V>>();
	/** Frequent: keys seen at least twice. Values resident. */
	#t2 = new Map<string, Entry<V>>();
	/** Ghost of `t1` — keys only, no values. */
	#b1 = new Set<string>();
	/** Ghost of `t2` — keys only, no values. */
	#b2 = new Set<string>();
	/** Adaptive target size for `t1`; grows on a `b1` hit, shrinks on a `b2` hit. */
	#p = 0;

	readonly #max: number;
	readonly #ttl: number;
	readonly #now: () => number;

	#hits = 0;
	#misses = 0;
	#ghostHits = 0;
	#evictions = 0;
	#expirations = 0;

	constructor(options: ArcCacheOptions) {
		// A zero-capacity cache would divide by zero in the adaptation step and silently disable
		// itself; refusing is better than a cache that reports hits it cannot have.
		if (options.maxEntries < 1) throw new Error("ArcCache requires maxEntries >= 1.");
		if (options.ttlMs <= 0) throw new Error("ArcCache requires ttlMs > 0.");
		this.#max = Math.floor(options.maxEntries);
		this.#ttl = options.ttlMs;
		this.#now = options.now ?? Date.now;
	}

	/** Whether an entry is still inside its TTL. */
	#fresh(entry: Entry<V>): boolean {
		return this.#now() - entry.storedAt < this.#ttl;
	}

	/** The least-recently-used key of a map, or `undefined` when empty. */
	static #lru<T>(map: Map<string, T>): string | undefined {
		return map.keys().next().value;
	}

	/** The least-recently-used key of a ghost set, or `undefined` when empty. */
	static #lruGhost(set: Set<string>): string | undefined {
		return set.values().next().value;
	}

	/**
	 * Whether the resident set is at capacity.
	 *
	 * REPLACE only makes sense on a full cache — its whole job is to choose a victim to make room —
	 * and in the paper that is guaranteed by the fact that a ghost list can only be reached by an
	 * eviction, which can only happen when the cache is full. This implementation has a second way to
	 * reach a ghost (see {@link #expire}), so the precondition has to be checked rather than assumed.
	 */
	#full(): boolean {
		return this.#t1.size + this.#t2.size >= this.#max;
	}

	/**
	 * Drop an entry that aged out.
	 *
	 * It is DELETED, not demoted to a ghost, and that distinction is the whole point. A ghost means
	 * "I evicted this to make room and I may have been wrong about which one to drop" — it is
	 * capacity evidence, and Case II/III react to it by shifting `p` and evicting a live neighbour to
	 * re-admit the key. An expired entry is not evidence of anything: the cache may be 1% full, and
	 * nothing was displaced.
	 *
	 * Demoting it anyway is a real bug and not a subtle one. With five keys in a 512-entry cache, the
	 * first TTL rollover would put a key in `b1`; the `set` that refreshed it would hit Case II, call
	 * REPLACE on a nearly-empty cache, and evict one of the four live neighbours to make room that
	 * already existed. Every refresh would cost a warm entry, and the hit rate would collapse while
	 * every invariant still held and every existing test still passed.
	 */
	#expire(key: string): void {
		this.#b1.delete(key);
		this.#b2.delete(key);
		this.#expirations++;
		this.#misses++;
	}

	/**
	 * ARC's REPLACE step — evict one resident entry into the ghost list matching the list it came
	 * from, choosing between `t1` and `t2` by the adaptive target `p`.
	 *
	 * The `inB2 && |t1| === p` clause is not redundant with `|t1| > p`: it breaks the tie in favour
	 * of evicting from `t1` when the key being admitted was itself a `t2` ghost, which is what stops
	 * `t2` from being drained by the very miss that is trying to defend it.
	 */
	#replace(incomingKey: string): void {
		const t1Size = this.#t1.size;
		const preferT1 = t1Size >= 1 &&
			((this.#b2.has(incomingKey) && t1Size === this.#p) || t1Size > this.#p);
		if (preferT1) {
			const victim = ArcCache.#lru(this.#t1);
			if (victim !== undefined) {
				this.#t1.delete(victim);
				this.#b1.add(victim);
				this.#evictions++;
			}
			return;
		}
		const victim = ArcCache.#lru(this.#t2);
		if (victim !== undefined) {
			this.#t2.delete(victim);
			this.#b2.add(victim);
			this.#evictions++;
		}
	}

	/** Trim a ghost list to its bound, dropping least-recently-added keys first. */
	#trimGhost(set: Set<string>, limit: number): void {
		while (set.size > limit) {
			const oldest = ArcCache.#lruGhost(set);
			if (oldest === undefined) return;
			set.delete(oldest);
		}
	}

	/**
	 * Read a key. A hit in `t1` PROMOTES to `t2` — the second touch is precisely the evidence ARC
	 * uses to separate a working-set key from a scan — and a hit in `t2` refreshes its recency.
	 *
	 * An expired entry is a miss AND is demoted to its ghost list rather than deleted outright, so
	 * the adaptation still learns from it: the key was worth keeping, it simply aged out.
	 */
	get(key: string): V | undefined {
		const inT1 = this.#t1.get(key);
		if (inT1 !== undefined) {
			this.#t1.delete(key);
			if (!this.#fresh(inT1)) {
				this.#expire(key);
				return undefined;
			}
			this.#t2.set(key, inT1);
			this.#hits++;
			return inT1.value;
		}

		const inT2 = this.#t2.get(key);
		if (inT2 !== undefined) {
			this.#t2.delete(key);
			if (!this.#fresh(inT2)) {
				this.#expire(key);
				return undefined;
			}
			this.#t2.set(key, inT2);
			this.#hits++;
			return inT2.value;
		}

		this.#misses++;
		if (this.#b1.has(key) || this.#b2.has(key)) this.#ghostHits++;
		return undefined;
	}

	/**
	 * Insert or update a key, running the full ARC admission policy.
	 *
	 * The four cases are the algorithm's, in its order: already resident (update, promote), a `b1`
	 * ghost (recency was under-weighted — grow `p`), a `b2` ghost (frequency was under-weighted —
	 * shrink `p`), and genuinely new (make room, then admit into `t1`).
	 */
	set(key: string, value: V): void {
		const entry: Entry<V> = { value, storedAt: this.#now() };

		// Case I — resident. An update is a second touch, so it belongs in `t2` regardless of which
		// list held it.
		if (this.#t1.has(key)) {
			this.#t1.delete(key);
			this.#t2.set(key, entry);
			return;
		}
		if (this.#t2.has(key)) {
			this.#t2.delete(key);
			this.#t2.set(key, entry);
			return;
		}

		// Case II — a ghost of `t1`: this key was evicted for recency and came back, so recency is
		// worth more than the current `p` says. `max(1, …)` guarantees forward progress when `b1` is
		// larger than `b2`, where the ratio would otherwise round to zero and freeze adaptation.
		if (this.#b1.has(key)) {
			const delta = this.#b1.size >= this.#b2.size
				? 1
				: Math.max(1, Math.floor(this.#b2.size / Math.max(1, this.#b1.size)));
			this.#p = Math.min(this.#max, this.#p + delta);
			// Only evict if there is genuinely no room. See {@link #full}.
			if (this.#full()) this.#replace(key);
			this.#b1.delete(key);
			this.#t2.set(key, entry);
			return;
		}

		// Case III — a ghost of `t2`: frequency was under-weighted, so shrink the recency target.
		if (this.#b2.has(key)) {
			const delta = this.#b2.size >= this.#b1.size
				? 1
				: Math.max(1, Math.floor(this.#b1.size / Math.max(1, this.#b2.size)));
			this.#p = Math.max(0, this.#p - delta);
			if (this.#full()) this.#replace(key);
			this.#b2.delete(key);
			this.#t2.set(key, entry);
			return;
		}

		// Case IV — new. Make room in the two invariants ARC maintains (`|t1|+|b1| <= c` and the
		// total directory `<= 2c`) before admitting.
		const l1 = this.#t1.size + this.#b1.size;
		if (l1 === this.#max) {
			if (this.#t1.size < this.#max) {
				const oldestGhost = ArcCache.#lruGhost(this.#b1);
				if (oldestGhost !== undefined) this.#b1.delete(oldestGhost);
				this.#replace(key);
			} else {
				// `b1` is empty and `t1` is full: evict a resident entry outright, with no ghost —
				// there is no room in the directory to remember it.
				const victim = ArcCache.#lru(this.#t1);
				if (victim !== undefined) {
					this.#t1.delete(victim);
					this.#evictions++;
				}
			}
		} else if (l1 < this.#max) {
			const total = this.#t1.size + this.#t2.size + this.#b1.size + this.#b2.size;
			if (total >= this.#max) {
				if (total >= 2 * this.#max) {
					const oldestGhost = ArcCache.#lruGhost(this.#b2);
					if (oldestGhost !== undefined) this.#b2.delete(oldestGhost);
				}
				this.#replace(key);
			}
		}

		this.#t1.set(key, entry);

		// Belt-and-braces: the policy above should already hold the resident set at `max`, but a
		// clamp here means a future edit to the case analysis can cost hit-rate and never memory.
		while (this.#t1.size + this.#t2.size > this.#max) {
			const victim = ArcCache.#lru(this.#t1) ?? ArcCache.#lru(this.#t2);
			if (victim === undefined) break;
			if (!this.#t1.delete(victim)) this.#t2.delete(victim);
			this.#evictions++;
		}
	}

	/**
	 * Read through the cache, computing on a miss.
	 *
	 * Concurrent callers are NOT coalesced: two simultaneous misses both compute. Coalescing would
	 * need an in-flight promise map, and sharing one promise across callers means sharing whatever
	 * it rejects with — a failure for one becomes a failure for all, including callers whose RLS
	 * scope would have succeeded. Two duplicate reads is the cheaper mistake.
	 */
	async through(key: string, compute: () => Promise<V>): Promise<V> {
		const hit = this.get(key);
		if (hit !== undefined) return hit;
		const value = await compute();
		this.set(key, value);
		return value;
	}

	/** Drop one key from every list, resident and ghost. */
	delete(key: string): void {
		this.#t1.delete(key);
		this.#t2.delete(key);
		this.#b1.delete(key);
		this.#b2.delete(key);
	}

	/**
	 * Drop everything belonging to one tenant — the invalidation a mutation performs.
	 *
	 * O(n) over the directory, which is acceptable because it runs on writes rather than reads and
	 * the directory is bounded at `2 × maxEntries`.
	 */
	clearTenant(tenant: CacheTenant): void {
		const prefix = tenantPrefix(tenant);
		for (const key of [...this.#t1.keys()]) if (key.startsWith(prefix)) this.#t1.delete(key);
		for (const key of [...this.#t2.keys()]) if (key.startsWith(prefix)) this.#t2.delete(key);
		for (const key of [...this.#b1]) if (key.startsWith(prefix)) this.#b1.delete(key);
		for (const key of [...this.#b2]) if (key.startsWith(prefix)) this.#b2.delete(key);
	}

	/** Drop every entry and reset the adaptation. Counters are preserved. */
	clear(): void {
		this.#t1.clear();
		this.#t2.clear();
		this.#b1.clear();
		this.#b2.clear();
		this.#p = 0;
	}

	/** Point-in-time counters. */
	stats(): CacheStats {
		return {
			hits: this.#hits,
			misses: this.#misses,
			ghostHits: this.#ghostHits,
			evictions: this.#evictions,
			expirations: this.#expirations,
			size: this.#t1.size + this.#t2.size,
			p: this.#p,
		};
	}
}

// #endregion

// #region Shared instances

/**
 * How long a read projection may be served from memory.
 *
 * Thirty seconds is chosen against what these endpoints are: a feed, a roster, a board. All of them
 * are re-read on navigation and none of them is a money figure, so a half-minute of staleness costs
 * a slightly-late unread badge. It is deliberately far shorter than the FX table's fifteen minutes
 * ({@link ../services/finance/FxService.ts}), because that caches a published reference rate and
 * this caches somebody's own mutable data.
 */
export const READ_CACHE_TTL_MS = 30_000;

/**
 * Resident entries per domain cache.
 *
 * Sized for a working set rather than a corpus: a few hundred entries covers many concurrent users
 * each holding a handful of open surfaces, and the cache exists to absorb the repeat reads inside
 * one navigation, not to hold the database. Note this bounds ENTRY COUNT, not bytes — a submissions
 * page is far larger than a summary — so it is a proxy for memory, and the TTL is the backstop that
 * makes the proxy safe.
 */
export const READ_CACHE_MAX_ENTRIES = 512;

/** The projects domain's read cache. Per-isolate; see the module docblock on invalidation. */
export const projectsReadCache = new ArcCache<unknown>({
	maxEntries: READ_CACHE_MAX_ENTRIES,
	ttlMs: READ_CACHE_TTL_MS,
});

/** The messaging domain's read cache. Separate instance so one domain cannot evict the other's. */
export const messagingReadCache = new ArcCache<unknown>({
	maxEntries: READ_CACHE_MAX_ENTRIES,
	ttlMs: READ_CACHE_TTL_MS,
});

/**
 * Read through a domain cache with the value type recovered at the call site.
 *
 * The shared instances are `ArcCache<unknown>` because one instance serves many payload shapes; this
 * helper is the single place that cast happens, so no call site has to write one. It is sound by
 * construction — the namespace in the key is what makes two shapes unable to share an entry.
 */
export function cachedRead<T>(
	cache: ArcCache<unknown>,
	key: string,
	compute: () => Promise<T>,
): Promise<T> {
	return cache.through(key, compute as () => Promise<unknown>) as Promise<T>;
}

// #endregion
