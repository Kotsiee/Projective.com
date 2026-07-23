/**
 * logger.ts — the web app's single, environment-aware logger.
 *
 * One API, two behaviours, switched on the build-time {@link IS_DEV} flag so the development-only
 * machinery is **tree-shaken out of production** (not merely skipped at runtime):
 *
 *  - **Development** — colourised `console` output plus an in-memory session history (a bounded ring
 *    buffer) that the Dev Tools Log & API Inspector reads and subscribes to. `info`/`debug`/`network`
 *    are all kept. An optional `fetch` interceptor auto-records every request/response as a `network`
 *    entry.
 *  - **Production** — the in-memory history, the subscriber set and the console noise **do not exist**
 *    (they are guarded by `IS_DEV`, which Vite replaces with `false`, so the bundler drops the branch).
 *    Only the durable levels (`warn`/`error`) are forwarded to `POST /api/logs` via
 *    `navigator.sendBeacon` (server-side, they fall through to native `console` for the platform log
 *    drain). `info`/`debug`/`network` are discarded to keep the payload small.
 *
 * Import the shared singleton {@link logger}. It is safe to call from anywhere (islands, SSR, routes);
 * the boundary is respected because persistence goes through the thin `/api/logs` route → fat
 * `LogBackendService`, never a direct DB touch.
 */

import type { LogEntry, LogLevel } from "@projective/types/logging";
import { IS_DEV } from "./dev.ts";
import { LocalKeys, readStored, removeStored, writeStored } from "./storage-keys.ts";

// #region Constants
/** Max entries retained in the dev session history before the oldest are evicted. */
const MAX_HISTORY = 500;
/** Cap (chars) applied to a serialized network/structured payload so one entry can't bloat memory. */
const MAX_PAYLOAD_CHARS = 12_000;
/** Max entries per production beacon batch (mirrors the Zod `LogBatchSchema` cap). */
const MAX_BATCH = 50;
/** Debounce (ms) for the dev history → storage write-through, so a burst of logs writes once. */
const PERSIST_DEBOUNCE_MS = 400;

/** Console `%c` badge colours per level (devtools console only — not UI, so literals are fine). */
const LEVEL_BADGE: Record<LogLevel, string> = {
	debug: "background:#6b7280;color:#fff",
	info: "background:#2f7dd1;color:#fff",
	warn: "background:#d98216;color:#fff",
	error: "background:#d94141;color:#fff",
	network: "background:#268c66;color:#fff",
};
// #endregion

// #region Input shapes
/** Fields accepted by {@link Logger.network}. */
export interface NetworkLog {
	method: string;
	url: string;
	status?: number;
	durationMs?: number;
	request?: unknown;
	response?: unknown;
	/** Overrides the auto-generated `"GET /path → 200"` message. */
	message?: string;
}
// #endregion

// #region Helpers
let seq = 0;
/** A collision-resistant id without pulling in a uuid dependency. */
function nextId(): string {
	seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
	return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** True in a browser (has a DOM). Server SSR has neither `document` nor `navigator.sendBeacon`. */
function inBrowser(): boolean {
	return typeof document !== "undefined";
}

/** Convert an `Error` (or anything) into a JSON-friendly value for the payload/inspector. */
function normalizeData(value: unknown): unknown {
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	return value;
}

/** Bound a payload's serialized size so a single entry can never blow up memory or the beacon body. */
function capPayload(value: unknown): unknown {
	if (value === undefined || value === null) return value;
	try {
		const json = JSON.stringify(value);
		if (json.length <= MAX_PAYLOAD_CHARS) return value;
		return { _truncated: true, preview: json.slice(0, MAX_PAYLOAD_CHARS) };
	} catch {
		// Circular / non-serializable — fall back to a string tag.
		return { _unserializable: Object.prototype.toString.call(value) };
	}
}

/** Minimal shape guard for a rehydrated cache entry — tolerant of a schema drift / corrupt blob. */
function isCachedEntry(value: unknown): value is LogEntry {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Partial<LogEntry>;
	return typeof e.id === "string" && typeof e.message === "string" &&
		typeof e.level === "string" && typeof e.at === "number";
}

/** Strip the origin from a same-origin URL for a compact console/inspector label. */
function shortenUrl(url: string): string {
	try {
		const u = new URL(url, inBrowser() ? location.href : "http://localhost");
		return u.pathname + u.search;
	} catch {
		return url;
	}
}
// #endregion

/**
 * The logger implementation. Prefer the shared {@link logger} singleton; the class is exported for
 * tests and for consumers that want an isolated instance.
 */
export class Logger {
	/**
	 * The dev session history. `null` in production (guarded by {@link IS_DEV}) so **no log cache exists
	 * in the shipped bundle** — the core production guardrail.
	 */
	private readonly history: LogEntry[] | null = IS_DEV ? [] : null;
	/** Inspector change-subscribers. `null` in production (no listeners retained). */
	private readonly subs: Set<() => void> | null = IS_DEV ? new Set() : null;
	/** Transient production beacon buffer (batched + flushed on a microtask, never retained). */
	private pending: LogEntry[] = [];
	private flushScheduled = false;
	/**
	 * DEV-only. Whether captured logs are written through to storage so they survive a reload (the Log
	 * Inspector's "Keep logs on refresh" switch). Restored from storage on boot; default on.
	 */
	private persistLogs = true;
	/** DEV-only. Pending debounced storage write handle (so a burst of logs collapses to one write). */
	private persistTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		// Boot dev persistence on the client (restore the pref, rehydrate the cache, arm the unload
		// flush). Guarded by IS_DEV so the whole path is eliminated from the production bundle; a no-op
		// on the server (no DOM) and in production (no history buffer).
		if (IS_DEV) this.bootPersistence();
	}

	// #region Public API
	/** Verbose developer trace (dev-only; discarded in production). */
	debug(message: string, data?: unknown): void {
		this.emit("debug", message, { data: normalizeData(data) });
	}

	/** Informational event (dev-only; discarded in production). */
	info(message: string, data?: unknown): void {
		this.emit("info", message, { data: normalizeData(data) });
	}

	/** A recoverable problem. Persisted in production. */
	warn(message: string, data?: unknown): void {
		this.emit("warn", message, { data: normalizeData(data) });
	}

	/** A failure. Persisted in production. Pass an `Error` as `data` to capture its stack. */
	error(message: string, data?: unknown): void {
		this.emit("error", message, { data: normalizeData(data) });
	}

	/** A network request/response trace (dev-only inspector data; discarded in production). */
	network(entry: NetworkLog): void {
		const label = entry.message ??
			`${entry.method} ${shortenUrl(entry.url)}${entry.status ? ` → ${entry.status}` : ""}`;
		this.emit("network", label, {
			method: entry.method,
			url: entry.url,
			status: entry.status,
			durationMs: entry.durationMs,
			request: capPayload(entry.request),
			response: capPayload(entry.response),
		});
	}

	/** The current dev session history (newest last). Always empty in production. */
	getLogs(): readonly LogEntry[] {
		return this.history ?? [];
	}

	/**
	 * Flush the dev session history AND the persisted cache, then notify subscribers. This is the Log
	 * Inspector's "Clear cache" / "Clear session logs" wipe — it clears both the in-memory buffer and the
	 * storage cache so a subsequent reload starts empty. No-op in production.
	 */
	clear(): void {
		if (!this.history) return;
		this.history.length = 0;
		removeStored("local", LocalKeys.DEV_LOG_CACHE);
		this.notify();
	}

	/** DEV: whether captured logs are kept across reloads. Always `false` in production. */
	isLogPersistenceOn(): boolean {
		return this.history ? this.persistLogs : false;
	}

	/**
	 * DEV: toggle "keep logs on refresh". Turning it ON persists the current history immediately (so a
	 * reload restores it); turning it OFF keeps the session's logs in memory but flushes the cache on the
	 * next page unload. Persists the preference itself so it survives a reload. No-op in production.
	 */
	setLogPersistence(on: boolean): void {
		if (!this.history) return;
		this.persistLogs = on;
		writeStored("local", LocalKeys.DEV_LOG_PERSIST, on ? "1" : "0");
		if (on) this.dehydrate();
		this.notify();
	}

	/**
	 * Subscribe to history changes (the inspector re-reads on each call). Returns an unsubscribe fn. A
	 * no-op returning a no-op in production, so no listener is ever retained.
	 */
	subscribe(fn: () => void): () => void {
		if (!this.subs) return () => {};
		this.subs.add(fn);
		return () => this.subs?.delete(fn);
	}
	// #endregion

	// #region Interceptors (dev-only)
	/**
	 * Wrap `globalThis.fetch` so every request is auto-logged as a `network` entry (method, URL, status,
	 * duration, and — best-effort — JSON request/response bodies). Returns an uninstall fn. Entirely a
	 * no-op in production (the body is guarded by {@link IS_DEV} and eliminated). Idempotent.
	 */
	installNetworkCapture(): () => void {
		if (!IS_DEV || typeof globalThis.fetch !== "function") return () => {};
		const raw = globalThis.fetch;
		if ((raw as { __pjWrapped?: boolean }).__pjWrapped) return () => {};
		// Bind the original to `globalThis` so calling it detached can't throw "Illegal invocation".
		const original = raw.bind(globalThis);

		// An arrow fn captures `this` (the Logger) lexically — no `this` alias needed.
		const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const started = globalThis.performance?.now?.() ?? Date.now();
			const method = (init?.method ??
				(typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET")
				.toUpperCase();
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			let request: unknown;
			if (typeof init?.body === "string") {
				try {
					request = JSON.parse(init.body);
				} catch {
					request = init.body;
				}
			}
			try {
				const res = await original(input, init);
				const durationMs = Math.round((globalThis.performance?.now?.() ?? Date.now()) - started);
				let response: unknown;
				try {
					response = await res.clone().json();
				} catch {
					// Non-JSON body — leave undefined.
				}
				this.network({ method, url, status: res.status, durationMs, request, response });
				return res;
			} catch (err) {
				const durationMs = Math.round((globalThis.performance?.now?.() ?? Date.now()) - started);
				this.network({
					method,
					url,
					status: 0,
					durationMs,
					request,
					message: `${method} ${shortenUrl(url)} → network error`,
				});
				throw err;
			}
		};
		(wrapped as { __pjWrapped?: boolean }).__pjWrapped = true;
		globalThis.fetch = wrapped as typeof fetch;
		return () => {
			globalThis.fetch = raw;
		};
	}

	/**
	 * Capture uncaught errors + unhandled promise rejections into the logger. Returns an uninstall fn.
	 * Dev-only here (mounted by the Dev Tools island); a production error pipeline would call
	 * {@link error} from its own boundary.
	 */
	installGlobalErrorCapture(): () => void {
		if (!IS_DEV || typeof globalThis.addEventListener !== "function") return () => {};
		const onError = (e: ErrorEvent) =>
			this.error(`Uncaught: ${e.message}`, { filename: e.filename, lineno: e.lineno });
		const onRejection = (e: PromiseRejectionEvent) =>
			this.error("Unhandled promise rejection", normalizeData(e.reason));
		globalThis.addEventListener("error", onError);
		globalThis.addEventListener("unhandledrejection", onRejection);
		return () => {
			globalThis.removeEventListener("error", onError);
			globalThis.removeEventListener("unhandledrejection", onRejection);
		};
	}
	// #endregion

	// #region Dev persistence (dev-only; eliminated from production)
	/**
	 * Boot dev-log persistence on the client: restore the "keep logs on refresh" preference, rehydrate
	 * any cached logs from a previous page load, and arm an unload flush that clears the cache when
	 * persistence is off. Called once from the constructor under {@link IS_DEV}; a no-op on the server
	 * (no DOM) and in production (no history buffer).
	 */
	private bootPersistence(): void {
		if (!this.history || !inBrowser()) return;
		const pref = readStored("local", LocalKeys.DEV_LOG_PERSIST);
		this.persistLogs = pref === null ? true : pref === "1";
		this.hydrate();
		try {
			// `pagehide` fires on navigations AND tab close (more reliable than `beforeunload`). When
			// persistence is off, flush the cache so the next load starts clean; when on, leave it.
			globalThis.addEventListener?.("pagehide", () => {
				if (!this.persistLogs) removeStored("local", LocalKeys.DEV_LOG_CACHE);
			});
		} catch {
			// No window / listener API — non-fatal.
		}
	}

	/** Load cached logs from storage into the in-memory history (older first, newest window kept). */
	private hydrate(): void {
		if (!this.history) return;
		const raw = readStored("local", LocalKeys.DEV_LOG_CACHE);
		if (!raw) return;
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return;
			const restored = parsed.filter(isCachedEntry);
			if (restored.length === 0) return;
			// Cached (older) entries first, then anything already captured on this load; cap to the ring.
			const merged = [...restored, ...this.history];
			this.history.length = 0;
			this.history.push(...merged.slice(-MAX_HISTORY));
			this.notify();
		} catch {
			// Corrupt cache — ignore and keep whatever is in memory.
		}
	}

	/**
	 * Write the current history through to storage (debounced). No-op when persistence is off, when there
	 * is no history (production), or off-DOM (server). Payloads are size-capped so the cache can't bloat.
	 */
	private dehydrate(): void {
		if (!this.history || !this.persistLogs || !inBrowser()) return;
		if (this.persistTimer !== undefined) return; // a write is already scheduled
		this.persistTimer = setTimeout(() => {
			this.persistTimer = undefined;
			if (!this.history) return;
			try {
				const slim = this.history.map((e) => ({
					...e,
					data: capPayload(e.data),
					request: capPayload(e.request),
					response: capPayload(e.response),
				}));
				writeStored("local", LocalKeys.DEV_LOG_CACHE, JSON.stringify(slim));
			} catch {
				// Quota exceeded / non-serialisable — drop silently; logging must never surface to the user.
			}
		}, PERSIST_DEBOUNCE_MS);
	}
	// #endregion

	// #region Internals
	/** Build an entry, then route it to the dev history or the production sink. */
	private emit(level: LogLevel, message: string, fields: Partial<LogEntry>): void {
		const entry: LogEntry = {
			id: nextId(),
			level,
			message,
			at: Date.now(),
			source: inBrowser() ? "client" : "server",
			...fields,
		};

		if (IS_DEV) {
			this.consoleOut(entry);
			this.push(entry);
			return;
		}

		// Production: only the durable levels are persisted; everything else is dropped.
		if (level === "warn" || level === "error") this.persist(entry);
	}

	/** Append to the ring buffer (dev only), notify the inspector, and write through to storage. */
	private push(entry: LogEntry): void {
		if (!this.history) return;
		this.history.push(entry);
		if (this.history.length > MAX_HISTORY) {
			this.history.splice(0, this.history.length - MAX_HISTORY);
		}
		this.notify();
		this.dehydrate();
	}

	private notify(): void {
		if (!this.subs) return;
		for (const fn of this.subs) fn();
	}

	/** Colourised console output (dev only). */
	private consoleOut(entry: LogEntry): void {
		const method = entry.level === "error"
			? console.error
			: entry.level === "warn"
			? console.warn
			: console.log;
		const payload = entry.level === "network"
			? {
				status: entry.status,
				durationMs: entry.durationMs,
				request: entry.request,
				response: entry.response,
			}
			: entry.data;
		method(
			`%c${entry.level.toUpperCase()}%c ${entry.message}`,
			`${LEVEL_BADGE[entry.level]};padding:1px 5px;border-radius:4px;font-weight:600`,
			"color:inherit",
			payload ?? "",
		);
	}

	/** Production persistence: batch `warn`/`error` and beacon them to `/api/logs`. */
	private persist(entry: LogEntry): void {
		// Server render (no beacon API): emit natively so the platform log drain captures it.
		if (
			!inBrowser() || typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function"
		) {
			(entry.level === "error" ? console.error : console.warn)(`[${entry.level}] ${entry.message}`);
			return;
		}
		this.pending.push({ ...entry, data: capPayload(entry.data) });
		if (!this.flushScheduled) {
			this.flushScheduled = true;
			queueMicrotask(() => this.flush());
		}
	}

	private flush(): void {
		this.flushScheduled = false;
		if (this.pending.length === 0) return;
		const entries = this.pending.splice(0, MAX_BATCH);
		try {
			const body = JSON.stringify({
				entries,
				meta: {
					path: inBrowser() ? location.pathname : undefined,
					userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
				},
			});
			navigator.sendBeacon("/api/logs", new Blob([body], { type: "application/json" }));
		} catch {
			// Beacon unavailable/oversized — drop silently; logging must never surface to the user.
		}
		if (this.pending.length > 0) queueMicrotask(() => this.flush());
	}
	// #endregion
}

/** The shared application logger. */
export const logger: Logger = new Logger();

export type { LogEntry, LogLevel } from "@projective/types/logging";
