import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { WebVitalsBatchSchema } from "@projective/types/logging";
import { LogBackendService } from "@server/services/logging/LogBackendService.ts";

/**
 * `POST /api/logs/vitals` — thin route: parse + Zod-validate one page view's Core Web Vitals (CLS,
 * LCP, INP) beaconed by the shell's `WebVitalsBridge` island in production, then delegate to
 * {@link LogBackendService.ingestVitals}, which stores them as `metric` rows in `ops.log_entries`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		const parsed = WebVitalsBatchSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false }, { status: 422 });
		}
		const result = await LogBackendService.ingestVitals(parsed.data, readActor(ctx));
		return Response.json(
			{ ok: result.ok, accepted: result.data?.accepted ?? 0 },
			{ status: result.status },
		);
	},
});
