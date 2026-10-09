import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { AccountLifecycleBackendService } from "@server/services/user/AccountLifecycleBackendService.ts";

/**
 * `POST /api/user/cron/erasures` — the scheduler's entry point for scheduled erasures: runs every
 * `org.deletion_requests` row that has come due (`security.purge_due_account_deletions`).
 *
 * Authenticated by a bearer token (`ACCOUNT_CRON_SECRET`, ≥ 32 characters), compared in constant
 * time; anything else is a 404, as the deposits cron. Safe to call as often as the scheduler likes: a
 * request completes once, and one whose blockers came back is deferred, not forced.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!AccountLifecycleBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "100") || 100, 1),
			500,
		);
		return serviceResponse(await AccountLifecycleBackendService.sweepDue(limit));
	},
});
