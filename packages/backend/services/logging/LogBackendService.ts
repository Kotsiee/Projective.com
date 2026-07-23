import { ok, type ServiceResult } from "../ServiceResult.ts";
import { isLoggingBackendLive } from "../../core/supabase.ts";
import { LogBatchSchema, type LogIngestResult } from "@projective/types/logging";

/**
 * LogBackendService — the FAT server-side log-ingestion service.
 *
 * The production half of the app's environment-aware logger. In development the logger keeps its
 * history in the browser for the Dev Tools inspector and never calls the server. In production it
 * forwards only the durable levels (`warn`/`error`) to `POST /api/logs`; the thin route Zod-validates
 * the batch and delegates here. Islands never reach this directly — the boundary forbids it
 * (SYSTEM_ARCHITECTURE.md §2).
 *
 * **Stub mode (default).** With `LOGGING_BACKEND_LIVE` off (see {@link isLoggingBackendLive}) the
 * service accepts and acknowledges the batch, echoing a compact summary to the server console so the
 * entries are not lost, but without any database write. The live path — an RLS-scoped insert into
 * `logging.entries` (Phase 2 migration) — slots in behind the same gate as a fill-in, not a
 * re-architecture (mirrors {@link NewsletterBackendService} / {@link ExploreBackendService}).
 */
export class LogBackendService {
	/**
	 * Persist a batch of production log entries. Re-validates against the Zod SSOT (defence in depth —
	 * the route validates too) and returns how many entries were accepted. Never throws to the caller:
	 * a logging failure must never surface to the user as an error.
	 */
	static ingest(input: unknown): ServiceResult<LogIngestResult> {
		const parsed = LogBatchSchema.safeParse(input);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return {
				ok: false,
				status: 422,
				errors: { [first?.path.join(".") || "entries"]: first?.message ?? "Invalid log batch." },
			};
		}

		const { entries, meta } = parsed.data;

		if (!isLoggingBackendLive()) {
			// Stub: acknowledge without persisting. Echo a one-line summary so nothing is silently dropped.
			for (const entry of entries) {
				const where = meta?.path ? ` @ ${meta.path}` : "";
				console[entry.level === "error" ? "error" : "warn"](
					`[log:${entry.level}]${where} ${entry.message}`,
				);
			}
			return ok({ accepted: entries.length });
		}

		// LIVE: insert into `logging.entries` (source-attributed, RLS-scoped) — not yet implemented.
		// Fall back to the stub acknowledgement so behaviour is preserved until that path lands.
		return ok({ accepted: entries.length });
	}
}
