import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/memberships/[membershipId]/cancel` — give up a seat. The late-cancel rule is the
 * database's (`projects.cancel_cohort_membership`): a full refund until the notice window before the
 * cohort's first sitting, a full forfeit to the provider inside it; the provider's own cancel always
 * refunds. The answer names which happened.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.membershipId;
		if (!UUID_RE.test(id)) return Response.json({ ok: false, message: "Unknown seat." }, { status: 404 });
		return toProjectsResponse(await SessionBackendService.cancelMembership(id, readActor(ctx)));
	},
});
