import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/sittings/[eventId]/no-show` `{ reason? }` — an attendee claims the provider did
 * not show. The claim (a `finance.disputes` row on the seat's held escrow) stops the 24-hour
 * auto-release until the presence log has been audited.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.eventId;
		if (!UUID_RE.test(id)) return Response.json({ ok: false, message: "Unknown session." }, { status: 404 });
		const body = await ctx.req.json().catch(() => null) as { reason?: unknown } | null;
		const reason = typeof body?.reason === "string" ? body.reason.slice(0, 480) : null;
		return toProjectsResponse(await SessionBackendService.claimNoShow(id, reason, readActor(ctx)));
	},
});
