import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfPayoutNotReady } from "@web/utils/payout-gate.ts";
import { AnswerEmailInvitationSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { EmailInvitationService } from "@server/services/projects/EmailInvitationService.ts";

/**
 * `POST /api/projects/invites/email` `{ token, accept }` — the addressee of an email invitation
 * answers it from its `/invite/[token]` page (PROJECTS NO1). Zod-validated, then the fat
 * {@link EmailInvitationService.answer}; on the live path `projects.answer_email_invitation`, which
 * refuses anybody who does not hold the invited address verified.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to answer this invitation." }, {
				status: 401,
			});
		}
		const parsed = AnswerEmailInvitationSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "This invitation link is not valid.", errors: { token: "invalid" } },
				{ status: 422 },
			);
		}
		if (parsed.data.accept) {
			const unpayable = refuseIfPayoutNotReady(ctx.req);
			if (unpayable) return unpayable;
		}
		return toProjectsResponse(await EmailInvitationService.answer(parsed.data, actor));
	},
});
