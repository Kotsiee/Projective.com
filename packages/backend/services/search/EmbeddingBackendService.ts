import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@projective/types/explore";
import { serverEnv } from "../../core/env.ts";
import { embeddingHashOf, estimateEmbeddingTokens } from "../../core/embedding-text.ts";
import { openSharedKv } from "../../core/kv.ts";
import {
	DOCUMENT_BATCH,
	planBatches,
	type VoyageCallPolicy,
	type VoyageDeps,
	voyageEmbed,
	type VoyageFailureReason,
	type VoyageOutcome,
} from "./voyage-client.ts";

/**
 * EmbeddingBackendService — voyage-4 vectors for discovery (Decision #179).
 *
 * `embedDocuments` turns listing, profile and project texts (`core/embedding-text.ts`) into the vectors
 * the backfill and the post-commit re-embed store; `embedQuery` turns a search into the vector
 * `search.fn_nearest` ranks against, through two cache layers keyed by the normalised query: a
 * per-isolate LRU + TTL cache (512 entries, 6 hours), then a {@link QueryVectorStore} in Deno KV
 * shared by every isolate (7 days), so a popular search costs one call per deployment rather than one
 * per cold isolate, and a concurrent burst of it costs one call and one KV read. KV is optional:
 * without `--unstable-kv` only the in-memory layer runs, and a slow or failing store is a miss.
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
	retryRateLimited: false,
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

// #region Query store
/** How long a query vector lives in the shared store. */
const QUERY_KV_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a store read may take before it counts as a miss, so a slow KV never slows a search. */
const QUERY_KV_TIMEOUT_MS = 50;

/**
 * The second, cross-isolate layer of the query cache. Neither method throws: `get` answers `null` on
 * a miss, an error or a timeout, and `set` swallows its own failures, so the store can only ever save
 * a Voyage call, never cost a search.
 */
export interface QueryVectorStore {
	/** The stored vector for `key`, or `null` on a miss, an error or a timeout. */
	get(key: Deno.KvKey): Promise<number[] | null>;
	/** Store `vector` under `key`. Resolves even when the write fails. */
	set(key: Deno.KvKey, vector: readonly number[]): Promise<void>;
}

/**
 * The store key for a normalised query (see {@link normaliseQuery}). The model and the width are part
 * of the key, so a model or dimension change starts a fresh namespace instead of serving vectors from
 * another space; the query itself appears only as its SHA-256 digest, never as raw search text.
 */
export async function queryCacheKey(normalised: string): Promise<Deno.KvKey> {
	return [
		"cache",
		"embeddings",
		EMBEDDING_MODEL,
		EMBEDDING_DIMENSIONS,
		"query",
		await embeddingHashOf(normalised),
	];
}

/** A vector as KV holds it: its `Float32Array` bytes (Voyage's own precision, 4,096 bytes). */
function encodeVector(vector: readonly number[]): Uint8Array {
	return new Uint8Array(Float32Array.from(vector).buffer);
}

/** A stored value back as a vector, or `null` for anything that is not exactly one finite vector. */
function decodeVector(value: unknown): number[] | null {
	if (!(value instanceof Uint8Array) || value.byteLength !== EMBEDDING_DIMENSIONS * 4) return null;
	const vector = Array.from(new Float32Array(value.slice().buffer));
	return vector.every(Number.isFinite) ? vector : null;
}

/** `promise`, or `null` once `ms` pass first. The timer is always cleared. */
async function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<null>((resolve) => timer = setTimeout(() => resolve(null), ms)),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * A {@link QueryVectorStore} over Deno KV, opened through `open` on first use (`null` = no KV, every
 * read a miss, every write a no-op). Entries expire after 7 days; a read slower than
 * {@link QUERY_KV_TIMEOUT_MS}, a failed read and a value of the wrong shape are all misses.
 */
export function kvQueryVectorStore(open: () => Promise<Deno.Kv | null>): QueryVectorStore {
	const kv = () => open().catch(() => null);
	return {
		async get(key) {
			try {
				const read = async () => {
					const handle = await kv();
					return handle ? decodeVector((await handle.get(key)).value) : null;
				};
				return await withinMs(read().catch(() => null), QUERY_KV_TIMEOUT_MS);
			} catch {
				return null;
			}
		},
		async set(key, vector) {
			try {
				const handle = await kv();
				await handle?.set(key, encodeVector(vector), { expireIn: QUERY_KV_TTL_MS });
			} catch {
				// The in-memory layer already holds it; a failed write costs other isolates a call.
			}
		},
	};
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

const DEFAULT_QUERY_STORE: QueryVectorStore = kvQueryVectorStore(openSharedKv);

let deps: VoyageDeps = DEFAULT_DEPS;
let queryStore: QueryVectorStore | null = DEFAULT_QUERY_STORE;
const queryCache = new QueryVectorCache(
	QUERY_CACHE_MAX_ENTRIES,
	QUERY_CACHE_TTL_MS,
	() => deps.now(),
);
const inflight = new Map<string, Promise<ServiceResult<number[]>>>();
let tokensUsed = 0;

/**
 * Swap the transport's dependencies — a stubbed `fetch`, an instant `sleep`, a fixed key — and reset the
 * cache and counters. `null` restores the real ones. The query store is `store` when one is passed;
 * otherwise stubbed deps run with no store at all and `null` restores the KV store. For unit tests only.
 */
export function setEmbeddingDepsForTesting(
	next: Partial<VoyageDeps> | null,
	store?: QueryVectorStore | null,
): void {
	deps = next ? { ...DEFAULT_DEPS, ...next } : DEFAULT_DEPS;
	queryStore = store !== undefined ? store : next ? null : DEFAULT_QUERY_STORE;
	queryCache.clear();
	inflight.clear();
	tokensUsed = 0;
	breaker = { failures: 0, openUntil: null, trialInFlight: false };
	bucket = { tokens: QUERY_BUCKET.capacity, at: null };
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

/** The stored vector, or `null`: a store that throws or rejects despite its contract is a miss. */
async function readStored(store: QueryVectorStore, key: Deno.KvKey): Promise<number[] | null> {
	try {
		return await store.get(key);
	} catch {
		return null;
	}
}

/**
 * The second half of {@link EmbeddingBackendService.embedQuery}, behind the in-memory cache and the
 * in-flight map: the shared store, then Voyage. A store hit fills the in-memory cache and costs no
 * tokens; a Voyage vector is written to both layers, the store fire-and-forget; a failure to neither.
 */
async function resolveQuery(
	key: string,
	store: QueryVectorStore | null,
): Promise<ServiceResult<number[]>> {
	const storeKey = store ? await queryCacheKey(key).catch(() => null) : null;
	if (store && storeKey) {
		const stored = await readStored(store, storeKey);
		if (stored) {
			queryCache.set(key, stored);
			return ok(stored);
		}
	}
	const admitted = admitQueryCall();
	if ("refusal" in admitted) return admitted.refusal;
	const outcome = await voyageEmbed([key], "query", QUERY_POLICY, deps);
	settleQueryCall(outcome, admitted.trial);
	if (!outcome.ok) return failure<number[]>(outcome);
	tokensUsed += outcome.tokens;
	queryCache.set(key, outcome.vectors[0]);
	if (store && storeKey) store.set(storeKey, outcome.vectors[0]).catch(() => {});
	return ok(outcome.vectors[0]);
}
// #endregion

// #region Query breaker
/** Consecutive transient query-call failures that open the breaker. */
const BREAKER_THRESHOLD = 3;
/** How long an open breaker refuses query calls, unless the tripping 429's `Retry-After` is longer. */
const BREAKER_COOLDOWN_MS = 30_000;
/** The longest a `Retry-After` may hold the breaker open. */
const BREAKER_MAX_COOLDOWN_MS = 5 * 60 * 1000;
/** Cache-miss query calls per isolate: a burst of `capacity`, refilled at `refillPerSec`. */
const QUERY_BUCKET = { capacity: 20, refillPerSec: 5 };
/** Failures that say nothing about Voyage's health — they neither count toward nor reset the breaker. */
const NON_TRANSIENT: ReadonlySet<VoyageFailureReason> = new Set([
	"rejected",
	"invalid_response",
	"unconfigured",
]);

interface BreakerState {
	failures: number;
	/** When the open breaker lets its trial call through; `null` while closed. */
	openUntil: number | null;
	trialInFlight: boolean;
}

let breaker: BreakerState = { failures: 0, openUntil: null, trialInFlight: false };
let bucket: { tokens: number; at: number | null } = { tokens: QUERY_BUCKET.capacity, at: null };

/** Whether a cache-miss query may call Voyage now: closed, the one half-open trial, or open. */
function breakerAdmits(now: number): "closed" | "trial" | "open" {
	if (breaker.openUntil === null) return "closed";
	return now < breaker.openUntil || breaker.trialInFlight ? "open" : "trial";
}

/** Take one token from the query bucket, refilled for the time since the last take; `false` when empty. */
function takeQueryToken(now: number): boolean {
	const elapsedSec = bucket.at === null ? 0 : Math.max(0, now - bucket.at) / 1000;
	bucket.tokens = Math.min(
		QUERY_BUCKET.capacity,
		bucket.tokens + elapsedSec * QUERY_BUCKET.refillPerSec,
	);
	bucket.at = now;
	if (bucket.tokens < 1) return false;
	bucket.tokens -= 1;
	return true;
}

/**
 * Admit one cache-miss query call, or refuse it with a 503 without touching the network: the breaker
 * first (`reason: "circuit_open"`), then the budget (`reason: "budget"`).
 */
function admitQueryCall(): { trial: boolean } | { refusal: ServiceResult<number[]> } {
	const now = deps.now();
	const state = breakerAdmits(now);
	if (state === "open") {
		return {
			refusal: fail(503, {
				message: "voyage-4 query breaker is open.",
				details: {
					reason: "circuit_open",
					retryAt: new Date(breaker.openUntil ?? now).toISOString(),
				},
			}),
		};
	}
	if (!takeQueryToken(now)) {
		return {
			refusal: fail(503, {
				message: "The voyage-4 query budget for this isolate is spent.",
				details: { reason: "budget" },
			}),
		};
	}
	if (state === "trial") breaker.trialInFlight = true;
	return { trial: state === "trial" };
}

/** Record a query call's outcome: a success closes the breaker; a transient failure may (re-)open it. */
function settleQueryCall(outcome: VoyageOutcome, trial: boolean): void {
	if (trial) breaker.trialInFlight = false;
	if (outcome.ok) {
		const wasOpen = breaker.openUntil !== null;
		breaker = { failures: 0, openUntil: null, trialInFlight: false };
		if (wasOpen) console.info("[embeddings] voyage-4 query breaker closed");
		return;
	}
	if (NON_TRANSIENT.has(outcome.reason)) return;
	breaker.failures++;
	// A call admitted before the breaker opened cannot extend it; only the trial or the threshold opens it.
	if (!trial && (breaker.openUntil !== null || breaker.failures < BREAKER_THRESHOLD)) return;
	const cooldown = Math.min(
		Math.max(BREAKER_COOLDOWN_MS, outcome.retryAfterMs ?? 0),
		BREAKER_MAX_COOLDOWN_MS,
	);
	breaker.openUntil = deps.now() + cooldown;
	console.warn(
		`[embeddings] voyage-4 query breaker open for ${Math.ceil(cooldown / 1000)}s — ` +
			`${outcome.reason}: ${outcome.detail}`,
	);
}

/**
 * The query breaker as it stands: whether it refuses calls now, when its trial call may go out
 * (`null` while closed) and the consecutive transient failures counted. For tests and diagnostics.
 */
export function embeddingBreakerState(): { open: boolean; until: number | null; failures: number } {
	return {
		open: breakerAdmits(deps.now()) === "open",
		until: breaker.openUntil,
		failures: breaker.failures,
	};
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
	 * Embed a search (`input_type: "query"`), served from the in-memory cache, then the shared store,
	 * when it can be. Concurrent requests for the same normalised query share one store read and one
	 * call; a failure is never cached in either layer. A query that
	 * fails {@link isEmbeddableQuery} is refused with a 422 (`reason: "not_embeddable"`) before any call.
	 * A cache miss then passes the query breaker and the per-isolate budget (`#region Query breaker`);
	 * either refuses with a 503 (`reason: "circuit_open"` / `"budget"`) without calling Voyage, while
	 * cache hits are served regardless.
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
		const call = resolveQuery(key, queryStore).finally(() => inflight.delete(key));
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
