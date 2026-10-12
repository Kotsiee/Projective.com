import type {
	LogBatchMeta,
	LogEntry,
	PersistedLogLevel,
	WebVital,
} from "@projective/types/logging";

/** An `ops.log_entries` row, less `user_id` (the writer sets it per identity). */
export interface LogEntryRow {
	client_id: string;
	level: PersistedLogLevel;
	message: string;
	occurred_at: string;
	source: "client" | "server";
	scope: string | null;
	method: string | null;
	url: string | null;
	status: number | null;
	duration_ms: number | null;
	request: unknown;
	response: unknown;
	data: unknown;
	path: string | null;
	user_agent: string | null;
	release: string | null;
}

/** Client clocks are untrusted; a non-finite or absurd `at` becomes the receipt time. */
function occurredAt(at: number, now: number): string {
	return Number.isFinite(at) && at > 0 && at < now + 86_400_000
		? new Date(at).toISOString()
		: new Date(now).toISOString();
}

function intOrNull(value: number | undefined): number | null {
	return value === undefined || !Number.isFinite(value) ? null : Math.round(value);
}

function envelope(meta: LogBatchMeta | undefined) {
	return {
		path: meta?.path ?? null,
		user_agent: meta?.userAgent ?? null,
		release: meta?.release ?? null,
	};
}

/**
 * Map a validated log batch to rows. Only the durable levels are stored: `debug`/`info`/`network`
 * pass the batch schema but would fail the table's level CHECK, so they are dropped here.
 */
export function toLogRows(
	entries: LogEntry[],
	meta: LogBatchMeta | undefined,
	now: number = Date.now(),
): LogEntryRow[] {
	const shared = envelope(meta);
	return entries
		.filter((e): e is LogEntry & { level: "warn" | "error" } =>
			e.level === "warn" || e.level === "error"
		)
		.map((e) => ({
			client_id: e.id,
			level: e.level,
			message: e.message,
			occurred_at: occurredAt(e.at, now),
			source: e.source ?? "client",
			scope: e.scope ?? null,
			method: e.method ?? null,
			url: e.url ?? null,
			status: intOrNull(e.status),
			duration_ms: intOrNull(e.durationMs),
			request: e.request ?? null,
			response: e.response ?? null,
			data: e.data ?? null,
			...shared,
		}));
}

/** `CLS 0.12` · `LCP 2480ms` — the human-readable line a vitals row carries. */
export function formatVital(vital: Pick<WebVital, "name" | "value">): string {
	return vital.name === "CLS"
		? `CLS ${vital.value.toFixed(3)}`
		: `${vital.name} ${Math.round(vital.value)}ms`;
}

/** Map a validated vitals batch to `metric` rows; the figures live in `data`. */
export function toVitalRows(
	vitals: WebVital[],
	meta: LogBatchMeta | undefined,
	now: number = Date.now(),
): LogEntryRow[] {
	const shared = envelope(meta);
	return vitals.map((v) => ({
		client_id: `${v.id}:${v.name}`,
		level: "metric",
		message: `${formatVital(v)} (${v.rating})`,
		occurred_at: occurredAt(v.at, now),
		source: "client",
		scope: "web-vitals",
		method: null,
		url: null,
		status: null,
		duration_ms: null,
		request: null,
		response: null,
		data: {
			name: v.name,
			value: v.value,
			rating: v.rating,
			navigationType: v.navigationType ?? null,
		},
		...shared,
	}));
}
