import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { EmailInvitationService } from "@server/services/projects/EmailInvitationService.ts";
import { NotificationDispatchService } from "@server/services/comms/NotificationDispatchService.ts";

/**
 * `POST /api/projects/cron/invitation-mail?limit=25` — the scheduler's entry point for email
 * invitations to addresses with no account (PROJECTS NO1): whatever could not go straight after its
 * invitation ({@link EmailInvitationService.sendDue}). Registered as the job `projects-invitation-mail`.
 *
 * Authenticated by the dispatcher's bearer, `COMMS_DISPATCH_SECRET`, in constant time; anything else
 * is a 404, as the other cron routes. The body is ignored. The limit stops at 25 for the reason the
 * guest-mail job gives: each send may take ten seconds and a claim is taken again after five minutes.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!NotificationDispatchService.isDispatchAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "25") || 25, 1),
			25,
		);
		return serviceResponse(await EmailInvitationService.sendDue(limit));
	},
});
