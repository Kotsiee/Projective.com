import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { CalendarSyncBackendService } from "@server/services/integrations/CalendarSyncBackendService.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/cron/sync` — the scheduler's entry point for calendar sync, one flow per job:
 * busy time in ({@link CalendarSyncBackendService.syncDue}, job `integrations-calendar-sync`) and, with
 * `?task=outbound`, Projective events out ({@link CalendarSyncBackendService.pushDue}, job
 * `integrations-outbound-sync`). Providers spec §7.6.
 *
 * Authenticated by a bearer token (`INTEGRATIONS_CRON_SECRET`, ≥ 32 characters), compared in constant
 * time; anything else is a 404, as the other cron routes. The body is ignored.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!IntegrationsBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "50") || 50, 1),
			500,
		);
		return toFilesResponse(
			ctx.url.searchParams.get("task") === "outbound"
				? await CalendarSyncBackendService.pushDue(limit)
				: await CalendarSyncBackendService.syncDue(limit),
		);
	},
});
