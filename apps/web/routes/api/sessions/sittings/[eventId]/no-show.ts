import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { NoShowClaimInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/sittings/[eventId]/no-show` `{ reason? }` — an attendee claims the provider did
 * not show. The claim (a `finance.disputes` row on the sitting's held escrow) stops the auto-release,
 * and once the sitting has ended the room's attendance is audited at once (Decision #212): the answer's
 * `status` says whether it was refunded, dismissed, or sent to the provider to respond.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.eventId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown session." }, { status: 404 });
		}
		const parsed = NoShowClaimInputSchema.safeParse((await ctx.req.json().catch(() => null)) ?? {});
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Keep the reason under 480 characters." }, {
				status: 422,
			});
		}
		return toProjectsResponse(
			await SessionBackendService.claimNoShow(id, parsed.data.reason || null, readActor(ctx)),
		);
	},
});
