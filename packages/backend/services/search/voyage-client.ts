import {
	EMBEDDING_DIMENSIONS,
	EMBEDDING_MODEL,
	type EmbeddingInputType,
} from "@projective/types/explore";
import { hasVoyageKey } from "../../core/embeddings-gate.ts";

/**
 * voyage-client — the one HTTP call to Voyage AI's embeddings API (Decision #179). Plain `fetch`, no
 * SDK. Server-only: it carries `VOYAGE_API_KEY`, which goes into the `Authorization` header and
 * nowhere else — never a log line, never an error detail.
 *
 * Every call goes to Voyage AI itself (`api.voyageai.com`), the processor the privacy notice names,
 * whatever the key looks like (Decision #340, ruling T5; #339 (d)). `VOYAGE_API_BASE` exists only to
 * point the client at a mock.
 *
 * Limits, from the Atlas Embedding and Reranking API reference (`POST /v1/embeddings`, read
 * 2026-10-12; the Voyage reference states the same): at most 1,000 inputs and 320K tokens per
 * request for `voyage-4`, 32K tokens per text. A free-trial key without a payment method is held to
 * 3 requests and 10K tokens a minute, which is why {@link planBatches} keeps a batch near 8K
 * estimated tokens rather than near the request cap.
 */

// #region Contract
/** Voyage AI's own endpoint — the only provider host the client calls. */
export const VOYAGE_PLATFORM_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

/** The endpoint: an explicit `base` host (a mock) wins; otherwise Voyage AI, whatever the key. */
export function embeddingsUrlFor(base?: string): string {
	const explicit = base?.trim().replace(/\/+$/, "");
	if (explicit && /^https?:\/\/[^/\s]+$/i.test(explicit)) return `${explicit}/v1/embeddings`;
	return VOYAGE_PLATFORM_EMBEDDINGS_URL;
}

/** At most two retries — three attempts — and only for a 429, a 5xx, a timeout or a network error. */
export const MAX_RETRIES = 2;

/** One batch's ceilings. */
export interface BatchLimits {
	maxInputs: number;
	maxTokens: number;
}

/** Far below the API's 1,000 inputs / 320K tokens, and under a free-trial key's 10K tokens a minute. */
export const DOCUMENT_BATCH: BatchLimits = { maxInputs: 128, maxTokens: 8_000 };

/** How long one call may take, in total and per attempt, and how it backs off between attempts. */
export interface VoyageCallPolicy {
	timeoutMs: number;
	deadlineMs: number;
	baseBackoffMs: number;
	maxBackoffMs: number;
	/**
	 * Whether a 429 is retried within the call (default `true`). `false` returns it at once, with the
	 * server's `Retry-After` on the outcome, so a caller with its own breaker does not press on a limit
	 * that has just refused it.
	 */
	retryRateLimited?: boolean;
}

/** What the transport needs from the world — injectable, so tests never touch the network or a clock. */
export interface VoyageDeps {
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	random: () => number;
	apiKey: () => string | undefined;
	/** `VOYAGE_API_BASE`, when set. */
	apiBase: () => string | undefined;
}

/** Why a call failed. Every reason sends discovery down its heuristic path. */
export type VoyageFailureReason =
	| "unconfigured"
	| "rate_limited"
	| "upstream"
	| "timeout"
	| "network"
	| "rejected"
	| "invalid_response";

/**
 * The outcome of {@link voyageEmbed}: unit vectors in input order and the billed tokens, or a reason —
 * with the server's `Retry-After`, in milliseconds, when a 429 carried one.
 */
export type VoyageOutcome =
	| { ok: true; vectors: number[][]; tokens: number; attempts: number }
	| {
		ok: false;
		reason: VoyageFailureReason;
		status?: number;
		detail: string;
		attempts: number;
		retryAfterMs?: number;
	};
// #endregion

// #region Batching
/**
 * Split `estimates` (one token estimate per text) into consecutive batches within `limits`, as index
 * lists. A single text over the token ceiling still gets a batch of its own — Voyage truncates it.
 */
export function planBatches(
	estimates: readonly number[],
	limits: BatchLimits = DOCUMENT_BATCH,
): number[][] {
	const batches: number[][] = [];
	let current: number[] = [];
	let tokens = 0;
	estimates.forEach((estimate, index) => {
		if (
			current.length > 0 &&
			(current.length >= limits.maxInputs || tokens + estimate > limits.maxTokens)
		) {
			batches.push(current);
			current = [];
			tokens = 0;
		}
		current.push(index);
		tokens += estimate;
	});
	if (current.length > 0) batches.push(current);
	return batches;
}
// #endregion

// #region Transport
type Attempt =
	| { ok: true; vectors: number[][]; tokens: number }
	| {
		ok: false;
		reason: VoyageFailureReason;
		status?: number;
		detail: string;
		retryable: boolean;
		retryAfterMs?: number;
	};

interface VoyageResponseBody {
	data?: Array<{ embedding?: unknown; index?: unknown }>;
	usage?: { total_tokens?: unknown };
}

function unit(vector: number[]): number[] {
	const norm = Math.hypot(...vector);
	return norm > 0 ? vector.map((v) => v / norm) : vector;
}

function parseVectors(body: VoyageResponseBody, expected: number): number[][] | null {
	if (!Array.isArray(body.data) || body.data.length !== expected) return null;
	const out: Array<number[] | undefined> = new Array(expected);
	for (const [position, row] of body.data.entries()) {
		const index = typeof row.index === "number" ? row.index : position;
		const embedding = row.embedding;
		if (
			!Number.isInteger(index) || index < 0 || index >= expected || out[index] ||
			!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS ||
			!embedding.every((v) => typeof v === "number" && Number.isFinite(v))
		) {
			return null;
		}
		out[index] = unit(embedding as number[]);
	}
	return out.every((v) => v !== undefined) ? out as number[][] : null;
}

function retryAfterMs(header: string | null, now: number): number | undefined {
	if (!header) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const at = Date.parse(header);
	return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function scrub(text: string, key: string): string {
	return (key ? text.split(key).join("[redacted]") : text).replace(/\s+/g, " ").trim().slice(
		0,
		200,
	);
}

async function attempt(
	texts: readonly string[],
	inputType: EmbeddingInputType,
	timeoutMs: number,
	deps: VoyageDeps,
): Promise<Attempt> {
	const key = deps.apiKey()?.trim() ?? "";
	if (!hasVoyageKey(key)) {
		return {
			ok: false,
			reason: "unconfigured",
			detail: "VOYAGE_API_KEY is not set",
			retryable: false,
		};
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await deps.fetch(embeddingsUrlFor(deps.apiBase()), {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({
				input: texts,
				model: EMBEDDING_MODEL,
				input_type: inputType,
				output_dimension: EMBEDDING_DIMENSIONS,
			}),
			signal: controller.signal,
		});
		if (res.ok) {
			const body = await res.json() as VoyageResponseBody;
			const vectors = parseVectors(body, texts.length);
			if (!vectors) {
				return {
					ok: false,
					reason: "invalid_response",
					status: res.status,
					detail: `expected ${texts.length} vectors of ${EMBEDDING_DIMENSIONS} dimensions`,
					retryable: false,
				};
			}
			const tokens = Number(body.usage?.total_tokens);
			return { ok: true, vectors, tokens: Number.isFinite(tokens) ? tokens : 0 };
		}
		const detail = `HTTP ${res.status}: ${scrub(await res.text(), key)}`;
		if (res.status === 429) {
			return {
				ok: false,
				reason: "rate_limited",
				status: 429,
				detail,
				retryable: true,
				retryAfterMs: retryAfterMs(res.headers.get("retry-after"), deps.now()),
			};
		}
		if (res.status >= 500) {
			return { ok: false, reason: "upstream", status: res.status, detail, retryable: true };
		}
		return { ok: false, reason: "rejected", status: res.status, detail, retryable: false };
	} catch (error) {
		if (controller.signal.aborted) {
			return {
				ok: false,
				reason: "timeout",
				detail: `no answer within ${timeoutMs} ms`,
				retryable: true,
			};
		}
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, reason: "network", detail: scrub(message, key), retryable: true };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Embed `texts` with voyage-4 as `inputType`, always sending `input_type` and `output_dimension`.
 * Returns unit-length vectors in input order. Retries a 429, a 5xx, a timeout or a network error at
 * most {@link MAX_RETRIES} times, with exponential backoff and jitter (or the server's `Retry-After`),
 * and never starts an attempt past `policy.deadlineMs`; with `policy.retryRateLimited: false` a 429 is
 * returned after its first attempt. Never throws.
 */
export async function voyageEmbed(
	texts: readonly string[],
	inputType: EmbeddingInputType,
	policy: VoyageCallPolicy,
	deps: VoyageDeps,
): Promise<VoyageOutcome> {
	const started = deps.now();
	let attempts = 0;
	let last: Extract<Attempt, { ok: false }> = {
		ok: false,
		reason: "timeout",
		detail: `no attempt fitted in ${policy.deadlineMs} ms`,
		retryable: false,
	};
	for (let n = 0; n <= MAX_RETRIES; n++) {
		const remaining = policy.deadlineMs - (deps.now() - started);
		if (remaining <= 0) break;
		attempts++;
		const result = await attempt(texts, inputType, Math.min(policy.timeoutMs, remaining), deps);
		if (result.ok) return { ...result, attempts };
		last = result;
		if (!result.retryable || n === MAX_RETRIES) break;
		if (result.reason === "rate_limited" && policy.retryRateLimited === false) break;
		const backoff = Math.min(policy.baseBackoffMs * 2 ** n, policy.maxBackoffMs) *
			(0.5 + deps.random() / 2);
		const wait = Math.min(result.retryAfterMs ?? backoff, policy.maxBackoffMs);
		if (deps.now() - started + wait >= policy.deadlineMs) break;
		await deps.sleep(wait);
	}
	const failed: VoyageOutcome = {
		ok: false,
		reason: last.reason,
		status: last.status,
		detail: last.detail,
		attempts,
	};
	if (last.retryAfterMs !== undefined) failed.retryAfterMs = last.retryAfterMs;
	return failed;
}
// #endregion
