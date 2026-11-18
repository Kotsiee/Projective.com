import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { DataExportBackendService } from "@server/services/user/DataExportBackendService.ts";

/**
 * `POST /api/user/cron/data-exports` — the scheduler's entry point for personal data exports (job
 * `account-data-exports`, Decision #450): builds up to `limit` requested archives, then removes those
 * past their 7 days (`DataExportBackendService.sweep`).
 *
 * Authenticated by a bearer token (`ACCOUNT_CRON_SECRET`, ≥ 32 characters), compared in constant
 * time; anything else is a 404, as the erasure cron. Safe to call as often as the scheduler likes: a
 * request is claimed once, and one whose build fails is retried, then failed.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!DataExportBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(Math.max(Number(ctx.url.searchParams.get("limit") ?? "5") || 5, 1), 25);
		return serviceResponse(await DataExportBackendService.sweep(limit));
	},
});
