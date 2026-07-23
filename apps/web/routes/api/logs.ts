import { define } from "@web/utils/state.ts";
import { LogBatchSchema } from "@projective/types/logging";
import { LogBackendService } from "@server/services/logging/LogBackendService.ts";

/**
 * `POST /api/logs` — thin route: parse + Zod-validate a production log batch, then delegate to the fat
 * {@link LogBackendService}, mapping its {@link ServiceResult} to a `Response`. The web app's universal
 * logger posts here (via `navigator.sendBeacon`) for `warn`/`error` entries in production only; in
 * development it keeps its history in-memory for the Dev Tools inspector and never calls this route. No
 * persistence logic lives here (SYSTEM_ARCHITECTURE.md §2 — thin routes, fat services).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => ({}));
		const parsed = LogBatchSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false }, { status: 422 });
		}
		const result = LogBackendService.ingest(parsed.data);
		return Response.json(
			{ ok: result.ok, accepted: result.data?.accepted ?? 0 },
			{ status: result.status },
		);
	},
});
