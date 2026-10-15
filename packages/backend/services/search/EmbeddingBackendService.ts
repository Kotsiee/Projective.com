import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { estimateEmbeddingTokens } from "../../core/embedding-text.ts";
import {
	DOCUMENT_BATCH,
	planBatches,
	type VoyageCallPolicy,
	type VoyageDeps,
	voyageEmbed,
	type VoyageOutcome,
} from "./voyage-client.ts";

/**
 * EmbeddingBackendService — voyage-4 vectors for discovery (Decision #179).
 *
 * `embedDocuments` turns listing, profile and project texts (`core/embedding-text.ts`) into the vectors
 * the backfill and the post-commit re-embed store; `embedQuery` turns a search into the vector
 * `search.fn_nearest` ranks against, through a process-wide LRU + TTL cache keyed by the normalised
 * query, so a popular search costs one call per process and a concurrent burst of it costs one too.
 *
 * Server-only. It holds `VOYAGE_API_KEY` (through `voyage-client.ts`) and is never imported by an
 * island; islands reach discovery through `/api/explore/*`. Nothing here decides WHETHER to embed —
 * callers check `isEmbeddingsLive` first — and nothing here throws: every failure is a
 * {@link ServiceResult} the caller turns into its heuristic path.
 */

// #region Policy
const QUERY_POLICY: VoyageCallPolicy = {
	timeoutMs: 2_000,
	deadlineMs: 3_000,
	baseBackoffMs: 150,
	maxBackoffMs: 600,
};
const DOCUMENT_POLICY: VoyageCallPolicy = {
	timeoutMs: 30_000,
	deadlineMs: 120_000,
	baseBackoffMs: 1_000,
	maxBackoffMs: 20_000,
};
const QUERY_CACHE_MAX_ENTRIES = 512;
const QUERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_QUERY_CHARS = 512;
/**
 * The shortest normalised query worth a Voyage call. Anything shorter — or with no letter in it — ranks
 * heuristically: "a", "!!" or "123" carry no meaning a vector could add.
 */
export const MIN_QUERY_CHARS = 3;
// #endregion

// #region Query cache
/**
 * A bounded LRU cache with a time-to-live, for query vectors. `get` refreshes recency; an expired entry
 * is a miss and is dropped. Vectors are held as `Float32Array` (Voyage's own precision) and handed out
 * as fresh arrays, so a caller can never mutate a cached vector.
 */
export class QueryVectorCache {
	#entries = new Map<string, { vector: Float32Array; expires: number }>();
	#maxEntries: number;
	#ttlMs: number;
	#now: () => number;

	constructor(maxEntries: number, ttlMs: number, now: () => number = Date.now) {
		this.#maxEntries = maxEntries;
		this.#ttlMs = ttlMs;
		this.#now = now;
	}

	/** The cached vector for `key`, or `undefined` when absent or expired. */
	get(key: string): number[] | undefined {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		this.#entries.delete(key);
		if (entry.expires <= this.#now()) return undefined;
		this.#entries.set(key, entry);
		return Array.from(entry.vector);
	}

	/** Store `vector` under `key`, evicting the least recently used entries past the bound. */
	set(key: string, vector: readonly number[]): void {
		this.#entries.delete(key);
		this.#entries.set(key, {
			vector: Float32Array.from(vector),
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

/**
 * The cache key — and the text sent — for a search: NFKC, whitespace collapsed, lower-cased, leading
 * non-alphanumerics and trailing punctuation stripped (a trailing `+` or `#` stays, so `c++` and `c#`
 * survive), capped. "Logo design!" and "logo design?" are one key.
 */
export function normaliseQuery(text: string): string {
	return text.normalize("NFKC")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+/u, "")
		.replace(/[^\p{L}\p{N}+#]+$/u, "")
		.slice(0, MAX_QUERY_CHARS)
		.trim();
}

/**
 * Whether a normalised query (see {@link normaliseQuery}) is worth embedding: at least
 * {@link MIN_QUERY_CHARS} characters and at least one letter. A query that is not ranks heuristically
 * and never calls Voyage.
 */
export function isEmbeddableQuery(normalised: string): boolean {
	return normalised.length >= MIN_QUERY_CHARS && /\p{L}/u.test(normalised);
}
// #endregion

// #region State
const DEFAULT_DEPS: VoyageDeps = {
	fetch: (input, init) => fetch(input, init),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
	random: () => Math.random(),
	apiKey: () => serverEnv().voyageApiKey,
	apiBase: () => serverEnv().voyageApiBase,
};

let deps: VoyageDeps = DEFAULT_DEPS;
const queryCache = new QueryVectorCache(
	QUERY_CACHE_MAX_ENTRIES,
	QUERY_CACHE_TTL_MS,
	() => deps.now(),
);
const inflight = new Map<string, Promise<ServiceResult<number[]>>>();
let tokensUsed = 0;

/**
 * Swap the transport's dependencies — a stubbed `fetch`, an instant `sleep`, a fixed key — and reset the
 * cache and counters. `null` restores the real ones. For unit tests only.
 */
export function setEmbeddingDepsForTesting(next: Partial<VoyageDeps> | null): void {
	deps = next ? { ...DEFAULT_DEPS, ...next } : DEFAULT_DEPS;
	queryCache.clear();
	inflight.clear();
	tokensUsed = 0;
}

function failure<T>(outcome: Extract<VoyageOutcome, { ok: false }>): ServiceResult<T> {
	const status = outcome.reason === "unconfigured"
		? 503
		: outcome.reason === "timeout"
		? 504
		: outcome.reason === "rate_limited"
		? 429
		: 502;
	return fail<T>(status, {
		message: `voyage-4 ${outcome.reason} after ${outcome.attempts} attempt(s): ${outcome.detail}`,
		details: {
			reason: outcome.reason,
			attempts: outcome.attempts,
			upstreamStatus: outcome.status ?? null,
		},
	});
}
// #endregion

export class EmbeddingBackendService {
	/**
	 * Embed document texts (`input_type: "document"`), in batches within `DOCUMENT_BATCH`, one batch at
	 * a time. All or nothing: a batch that still fails after its retries fails the call, and nothing is
	 * returned for the batches before it — callers that want partial progress pass smaller lists.
	 */
	static async embedDocuments(texts: readonly string[]): Promise<ServiceResult<number[][]>> {
		if (texts.length === 0) return ok([]);
		const vectors: number[][] = [];
		for (const batch of planBatches(texts.map(estimateEmbeddingTokens), DOCUMENT_BATCH)) {
			const outcome = await voyageEmbed(
				batch.map((i) => texts[i]),
				"document",
				DOCUMENT_POLICY,
				deps,
			);
			if (!outcome.ok) return failure(outcome);
			tokensUsed += outcome.tokens;
			vectors.push(...outcome.vectors);
		}
		return ok(vectors);
	}

	/**
	 * Embed a search (`input_type: "query"`), served from the query cache when it can be. Concurrent
	 * requests for the same normalised query share one call; a failure is never cached. A query that
	 * fails {@link isEmbeddableQuery} is refused with a 422 (`reason: "not_embeddable"`) before any call.
	 */
	static embedQuery(text: string): Promise<ServiceResult<number[]>> {
		const key = normaliseQuery(text);
		if (!isEmbeddableQuery(key)) {
			return Promise.resolve(fail(422, {
				message: `A query needs at least ${MIN_QUERY_CHARS} characters and a letter to embed.`,
				details: { reason: "not_embeddable" },
			}));
		}
		const cached = queryCache.get(key);
		if (cached) return Promise.resolve(ok(cached));
		const pending = inflight.get(key);
		if (pending) return pending;
		const call = voyageEmbed([key], "query", QUERY_POLICY, deps).then((outcome) => {
			if (!outcome.ok) return failure<number[]>(outcome);
			tokensUsed += outcome.tokens;
			queryCache.set(key, outcome.vectors[0]);
			return ok(outcome.vectors[0]);
		}).finally(() => inflight.delete(key));
		inflight.set(key, call);
		return call;
	}

	/** Tokens Voyage reported for every successful call in this process — the backfill's bill. */
	static tokensUsed(): number {
		return tokensUsed;
	}
}

/**
 * Log, once, that a semantic path fell back to the heuristic — one server-log line per occurrence,
 * never the key, never anything a user sees.
 */
export function reportEmbeddingFallback(where: string, cause: unknown): void {
	const reason = cause instanceof Error ? cause.message : String(cause);
	console.warn(`[embeddings] ${where} fell back to heuristic ranking — ${reason}`);
}
