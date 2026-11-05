import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/cron/channels` — the scheduler's entry point for push-channel renewal: every
 * channel within 24 hours of lapsing is renewed at its provider
 * ({@link IntegrationsBackendService.renewChannels}). Registered as the job
 * `integrations-renew-channels` (providers spec §7.6).
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
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "100") || 100, 1),
			500,
		);
		return toFilesResponse(await IntegrationsBackendService.renewChannels(limit));
	},
});
