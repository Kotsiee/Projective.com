/**
 * @projective/types/logging — the Zod SSOT for the log-ingestion contract.
 *
 * The web app's universal logger (`apps/web/utils/logger.ts`) is environment-aware: in development it
 * keeps an in-memory session history for the Dev Tools inspector; in **production** it forwards
 * `error`/`warn` entries to `POST /api/logs`, which validates the body against these schemas and hands
 * it to the fat `LogBackendService` for persistence (stub-first behind `LOGGING_BACKEND_LIVE`).
 *
 * Only enum/string/number/array/object/unknown/boolean primitives are used, so the schema is stable
 * across Zod majors (matching the convention in `@projective/types/auth`).
 */

import { z } from "zod";

// #region Level
/**
 * Severity of a log entry. `debug`/`info` are dev-only noise (never persisted); `warn`/`error` are the
 * durable levels; `network` is a request/response trace (dev inspector only, never persisted).
 */
export const LogLevel = z.enum(["debug", "info", "warn", "error", "network"]);
export type LogLevel = z.infer<typeof LogLevel>;

/** Where the entry originated — the browser island layer or the server (SSR/route/service). */
export const LogSource = z.enum(["client", "server"]);
export type LogSource = z.infer<typeof LogSource>;
// #endregion

// #region Entry
/**
 * A single structured log entry. The same shape backs the dev in-memory history and the production
 * ingest body; network-only fields (`method`/`url`/`status`/`durationMs`/`request`/`response`) are
 * present on `network` traces and omitted otherwise. `data` carries an arbitrary structured payload
 * (validated as unknown here; the logger caps its serialized size before sending).
 */
export const LogEntrySchema = z.object({
	/** Client-generated unique id (also the React key in the inspector). */
	id: z.string().max(64),
	/** Severity. */
	level: LogLevel,
	/** Human-readable message. */
	message: z.string().max(4000),
	/** Epoch milliseconds when the entry was created. */
	at: z.number(),
	/** Origin layer (default `client`). */
	source: LogSource.optional(),
	/** Optional scope/tag (e.g. a feature or subsystem name). */
	scope: z.string().max(64).optional(),
	/** HTTP method (network traces). */
	method: z.string().max(12).optional(),
	/** Request URL (network traces). */
	url: z.string().max(2048).optional(),
	/** HTTP status code (network traces). */
	status: z.number().optional(),
	/** Round-trip duration in ms (network traces). */
	durationMs: z.number().optional(),
	/** Request payload (network traces) — arbitrary JSON, size-capped by the logger. */
	request: z.unknown().optional(),
	/** Response payload (network traces) — arbitrary JSON, size-capped by the logger. */
	response: z.unknown().optional(),
	/** Structured payload for non-network entries. */
	data: z.unknown().optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;
// #endregion

// #region Ingest batch
/** Envelope metadata sent alongside a persisted batch (best-effort diagnostics). */
export const LogBatchMetaSchema = z.object({
	/** The path the entries were produced on. */
	path: z.string().max(2048).optional(),
	/** Coarse client hint (never PII). */
	userAgent: z.string().max(512).optional(),
	/** App build/release id, when available. */
	release: z.string().max(64).optional(),
});
export type LogBatchMeta = z.infer<typeof LogBatchMetaSchema>;

/**
 * The production ingest body: one or more `warn`/`error` entries. Capped at 50 entries per request so
 * a runaway client can't post an unbounded batch; the logger flushes in small batches via
 * `navigator.sendBeacon`.
 */
export const LogBatchSchema = z.object({
	entries: z.array(LogEntrySchema).min(1).max(50),
	meta: LogBatchMetaSchema.optional(),
});
export type LogBatch = z.infer<typeof LogBatchSchema>;

/** The successful ingest outcome returned by the fat service. */
export interface LogIngestResult {
	/** How many entries were accepted for persistence. */
	accepted: number;
}

/**
 * The levels `ops.log_entries.level` stores: the two durable {@link LogLevel}s plus `metric`, a
 * Core Web Vitals sample. `metric` is not a logger level — nothing calls `logger.metric`.
 */
export const PersistedLogLevel = z.enum(["warn", "error", "metric"]);
export type PersistedLogLevel = z.infer<typeof PersistedLogLevel>;
// #endregion

// #region Web vitals
/** The three Core Web Vitals the shell measures: layout shift, largest paint, interaction latency. */
export const WebVitalName = z.enum(["CLS", "LCP", "INP"]);
export type WebVitalName = z.infer<typeof WebVitalName>;

/** The published Core Web Vitals bands. */
export const WebVitalRating = z.enum(["good", "needs-improvement", "poor"]);
export type WebVitalRating = z.infer<typeof WebVitalRating>;

/** One final metric value for one page view. CLS is unitless; LCP and INP are milliseconds. */
export const WebVitalSchema = z.object({
	name: WebVitalName,
	value: z.number().min(0).max(600_000),
	rating: WebVitalRating,
	/** Page-view id shared by the vitals of one load, so the three can be joined. */
	id: z.string().min(1).max(64),
	/** `PerformanceNavigationTiming.type` (`navigate` · `reload` · `back_forward` · `prerender`). */
	navigationType: z.string().max(24).optional(),
	/** Epoch ms when the value was finalised. */
	at: z.number(),
});
export type WebVital = z.infer<typeof WebVitalSchema>;

/** The `POST /api/logs/vitals` body: at most one sample per metric per page view. */
export const WebVitalsBatchSchema = z.object({
	vitals: z.array(WebVitalSchema).min(1).max(3),
	meta: LogBatchMetaSchema.optional(),
});
export type WebVitalsBatch = z.infer<typeof WebVitalsBatchSchema>;
// #endregion
