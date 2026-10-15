import type { ExploreParams } from "@projective/types/explore";
import { normaliseQuery } from "../search/EmbeddingBackendService.ts";
import { nearestTo } from "../search/embedding-index.ts";
import type { SemanticSimilarity } from "./semantic.ts";

/**
 * similarity-cache — the short-lived memory of a search's resolved `search.fn_nearest` neighbours
 * (Decision #179), so "load more" on the same query does not repeat the database round-trip.
 *
 * The query VECTOR is already cached for hours by `EmbeddingBackendService`; this caches what the
 * vector found — the item-id → similarity map plus the vector itself — for {@link SIMILARITY_CACHE_TTL_MS},
 * keyed by the normalised query and the category ({@link similarityCacheKey}). Only a non-empty
 * successful lookup is stored; a miss, an empty neighbourhood or a failure is never remembered.
 *
 * It is not cleared by `invalidateCatalog`, and needs not be: `semanticResults` takes its candidates
 * from the CURRENT corpus and admits a neighbour only when the current corpus still holds its id, so a
 * map resolved against an older catalogue can never resurrect a withdrawn item or bypass a facet. The
 * most a stale entry can do, for at most one TTL, is omit a listing embedded since, carry a pre-edit
 * score, or let a withdrawn item's score raise the extras floor (fewer extras, never a wrong one) — the
 * same order of staleness the catalogue's own TTL already accepts.
 */

// #region Constants
/** The most searches remembered at once; the least recently used past this are evicted. */
export const SIMILARITY_CACHE_MAX_ENTRIES = 256;
/** How long one search's neighbours are reused: long enough to page through, short enough to track edits. */
export const SIMILARITY_CACHE_TTL_MS = 60_000;
// #endregion

// #region Cache
/** One search's resolved neighbours and the query vector that found them. */
export interface CachedSimilarity {
	similarity: SemanticSimilarity;
	vector: number[];
}

/**
 * A bounded LRU cache with a time-to-live, for resolved query similarity. `get` refreshes recency; an
 * expired entry is a miss and is dropped. The vector is copied in and out, so a caller can never
 * mutate a cached one.
 */
export class SimilarityCache {
	#entries = new Map<string, { value: CachedSimilarity; expires: number }>();
	#maxEntries: number;
	#ttlMs: number;
	#now: () => number;

	constructor(maxEntries: number, ttlMs: number, now: () => number = Date.now) {
		this.#maxEntries = maxEntries;
		this.#ttlMs = ttlMs;
		this.#now = now;
	}

	/** The cached neighbours for `key`, or `undefined` when absent or expired. */
	get(key: string): CachedSimilarity | undefined {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		this.#entries.delete(key);
		if (entry.expires <= this.#now()) return undefined;
		this.#entries.set(key, entry);
		return { similarity: entry.value.similarity, vector: [...entry.value.vector] };
	}

	/**
	 * Store `value` under `key`, evicting the least recently used entries past the bound. An empty
	 * similarity map is ignored: only a lookup that found something is worth reusing.
	 */
	set(key: string, value: CachedSimilarity): void {
		if (value.similarity.size === 0) return;
		this.#entries.delete(key);
		this.#entries.set(key, {
			value: { similarity: new Map(value.similarity), vector: [...value.vector] },
			expires: this.#now() + this.#ttlMs,
		});
		while (this.#entries.size > this.#maxEntries) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.#entries.delete(oldest);
		}
	}

	/** How many entries are held, expired ones included until they are next read. */
	get size(): number {
		return this.#entries.size;
	}

	/** Drop everything. */
	clear(): void {
		this.#entries.clear();
	}
}

/** The cache key for a search's neighbours: the normalised query and the category it is scoped to. */
export function similarityCacheKey(params: Pick<ExploreParams, "q" | "category">): string {
	return `${normaliseQuery(params.q)}|${params.category}`;
}
// #endregion

// #region Shared instance & test seam
/** What a similarity lookup reaches outside the process — swapped wholesale by tests. */
export interface SimilarityDeps {
	nearestTo: typeof nearestTo;
	now: () => number;
}

const DEFAULT_DEPS: SimilarityDeps = { nearestTo, now: () => Date.now() };

let deps: SimilarityDeps = DEFAULT_DEPS;

/** The isolate's similarity cache, on the seam's clock. */
export const similarityCache = new SimilarityCache(
	SIMILARITY_CACHE_MAX_ENTRIES,
	SIMILARITY_CACHE_TTL_MS,
	() => deps.now(),
);

/** The current dependencies — the real `search.fn_nearest` and wall clock unless a test swapped them. */
export function similarityDeps(): SimilarityDeps {
	return deps;
}

/**
 * Replace the lookup's dependencies — for unit tests only. `null` restores the real ones. Either way
 * the cache is emptied, so no test sees another's entries.
 */
export function setSimilarityDepsForTesting(next: Partial<SimilarityDeps> | null): void {
	deps = next ? { ...DEFAULT_DEPS, ...next } : DEFAULT_DEPS;
	similarityCache.clear();
}
// #endregion
