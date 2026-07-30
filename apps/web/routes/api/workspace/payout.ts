import { define } from "@web/utils/state.ts";
import { UpdatePayoutInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/payout` — thin route: Zod-validate a TEAM's payout split (model · per-member stakes
 * in basis points · auto-distribute), then delegate to the fat
 * {@link WorkspaceBackendService.updatePayout}.
 *
 * **The route does not check that the shares total 100%.** The 100% invariant is money policy, so it is
 * enforced exactly once, server-side, where the stored split lives — `422` with the human overshoot/
 * shortfall message the editor renders verbatim (`"The split is over by 1%. Shares must total 100%."`).
 * A route-side copy of that arithmetic is the classic way two layers start disagreeing about money.
 *
 * Sending this for a business is refused `422`: a business governs SPEND, not a payout split, and the two
 * policies are not interchangeable views of one thing.
 *
 * **No server-side capability guard** — `manage_finances` authority is the fat service's decision, and the
 * Dev Context Switcher must reach the money module as a simulated vault role. Deferred `finance.*` RLS is
 * the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpdatePayoutInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Check the highlighted fields.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(WorkspaceBackendService.updatePayout(parsed.data, viewer));
	},
});
