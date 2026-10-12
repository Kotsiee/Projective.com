import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isLoggingBackendLive } from "../../core/supabase.ts";
import { ANONYMOUS_READER, type ReadActor } from "../read-actor.ts";
import { writeTelemetry } from "../telemetry-writer.ts";
import { type LogEntryRow, toLogRows, toVitalRows } from "./log-rows.ts";
import {
	LogBatchSchema,
	type LogEntry,
	type LogIngestResult,
	WebVitalsBatchSchema,
} from "@projective/types/logging";

const MAX_SERVER_MESSAGE = 4000;
const MAX_SERVER_STACK = 8000;

/** A Zod failure as the `422` envelope every ingest returns. */
function invalid(
	issues: { path: PropertyKey[]; message: string }[],
	fallback: string,
): ServiceResult<LogIngestResult> {
	const first = issues[0];
	return fail(422, {
		errors: { [first?.path.join(".") || "entries"]: first?.message ?? fallback },
	});
}

/**
 * LogBackendService — the FAT server-side log-ingestion service.
 *
 * The production half of the app's environment-aware logger. In development the logger keeps its
 * history in the browser for the Dev Tools inspector and never calls the server. In production it
 * forwards only the durable levels (`warn`/`error`) to `POST /api/logs`, the shell's
 * `WebVitalsBridge` beacons one Core Web Vitals sample per metric per page view to
 * `POST /api/logs/vitals`, and `routes/_error.tsx` records server-side 5xx failures. Every path lands
 * in `ops.log_entries`, inserted as the caller under RLS (anonymous rows are the normal case).
 * Islands never reach this directly — the boundary forbids it (SYSTEM_ARCHITECTURE.md §2).
 *
 * **Stub mode (default).** With `LOGGING_BACKEND_LIVE` off (see {@link isLoggingBackendLive}) log
 * batches are acknowledged and echoed to the server console so they reach the platform log drain;
 * vitals are acknowledged silently.
 */
export class LogBackendService {
	/**
	 * Persist a batch of production log entries. Re-validates against the Zod SSOT (defence in depth —
	 * the route validates too) and returns how many entries were stored. A database failure is
	 * reported as `503` and echoed to the console; it never surfaces to the user.
	 */
	static async ingest(
		input: unknown,
		actor: ReadActor = ANONYMOUS_READER,
	): Promise<ServiceResult<LogIngestResult>> {
		const parsed = LogBatchSchema.safeParse(input);
		if (!parsed.success) return invalid(parsed.error.issues, "Invalid log batch.");
		const { entries, meta } = parsed.data;

		if (!isLoggingBackendLive()) {
			LogBackendService.echo(entries, meta?.path);
			return ok({ accepted: entries.length });
		}

		const rows = toLogRows(entries, meta);
		if (rows.length === 0) return ok({ accepted: 0 });
		return await LogBackendService.persist(
			rows,
			actor,
			() => LogBackendService.echo(entries, meta?.path),
		);
	}

	/** Persist one page view's Core Web Vitals as `metric` rows. */
	static async ingestVitals(
		input: unknown,
		actor: ReadActor = ANONYMOUS_READER,
	): Promise<ServiceResult<LogIngestResult>> {
		const parsed = WebVitalsBatchSchema.safeParse(input);
		if (!parsed.success) return invalid(parsed.error.issues, "Invalid vitals batch.");
		const { vitals, meta } = parsed.data;

		if (!isLoggingBackendLive()) return ok({ accepted: vitals.length });
		return await LogBackendService.persist(toVitalRows(vitals, meta), actor);
	}

	/**
	 * Record a server-side failure (an uncaught SSR or route error). Always written to the console
	 * with its stack; also stored as a `source: "server"` row when the backend is live.
	 */
	static async recordServerError(
		error: unknown,
		context: { path: string; method: string; status: number },
		actor: ReadActor = ANONYMOUS_READER,
	): Promise<ServiceResult<LogIngestResult>> {
		console.error(`[server:${context.status}] ${context.method} ${context.path}`, error);
		if (!isLoggingBackendLive()) return ok({ accepted: 0 });

		const message = error instanceof Error ? error.message : String(error);
		const entry: LogEntry = {
			id: crypto.randomUUID(),
			level: "error",
			message: message.slice(0, MAX_SERVER_MESSAGE) || "Unknown server error",
			at: Date.now(),
			source: "server",
			scope: "ssr",
			method: context.method,
			status: context.status,
			data: {
				name: error instanceof Error ? error.name : typeof error,
				stack: error instanceof Error ? error.stack?.slice(0, MAX_SERVER_STACK) : undefined,
			},
		};
		return await LogBackendService.persist(toLogRows([entry], { path: context.path }), actor);
	}

	private static async persist(
		rows: LogEntryRow[],
		actor: ReadActor,
		onFailure?: () => void,
	): Promise<ServiceResult<LogIngestResult>> {
		try {
			await writeTelemetry(actor, (db, userId) =>
				db.schema("ops").from("log_entries").insert(
					rows.map((row) => ({ ...row, user_id: userId })),
				));
			return ok({ accepted: rows.length });
		} catch (error) {
			console.error("[log] ops.log_entries insert failed", error);
			onFailure?.();
			return fail(503, { message: "Log entries could not be stored." });
		}
	}

	/** One console line per entry so the platform log drain still sees what was not stored. */
	private static echo(entries: LogEntry[], path: string | undefined): void {
		const where = path ? ` @ ${path}` : "";
		for (const entry of entries) {
			const write = entry.level === "error" ? console.error : console.warn;
			write(`[log:${entry.level}]${where} ${entry.message}`);
		}
	}
}
