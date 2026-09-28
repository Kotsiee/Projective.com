import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdatePayoutInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/payout` — thin route: refuse a guest, Zod-validate a TEAM's split (per-member
 * stakes in basis points, each optionally held), then delegate to the fat
 * {@link WorkspaceBackendService.updatePayout}.
 *
 * **The route does not check that the shares total 100%.** That invariant is money policy, enforced
 * exactly once where the stored split lives (`finance.save_team_split`), with the human message the
 * editor renders verbatim. A route-side copy of that arithmetic is how two layers start disagreeing
 * about money.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpdatePayoutInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.updatePayout(parsed.data, actor));
	},
});
