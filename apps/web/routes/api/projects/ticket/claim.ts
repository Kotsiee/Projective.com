import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { refuseIfPayoutNotReady } from "@web/utils/payout-gate.ts";
import { ClaimTicketSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/ticket/claim` — a freelancer self-claims one `open_pull` ticket. Zod-validated
 * against {@link ClaimTicketSchema}, then the fat {@link ProjectBackendService.claimTicket}, which
 * calls `projects.claim_ticket` in the caller's JWT: capacity, payout readiness and the escrow hold
 * are all the database's. The claimant is always the session's own user, never the payload.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to claim a ticket." }, { status: 401 });
		}
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const unpayable = refuseIfPayoutNotReady(ctx.req);
		if (unpayable) return unpayable;
		const parsed = ClaimTicketSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json({ ok: false, message: "Check the highlighted fields.", errors }, {
				status: 422,
			});
		}
		return toProjectsResponse(await ProjectBackendService.claimTicket(parsed.data, actor));
	},
});
