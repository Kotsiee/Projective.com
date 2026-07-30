import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/spend-decide` — thin route: validate the decision, then delegate to the fat
 * {@link WorkspaceBackendService.decideSpend} to approve or decline an outstanding spend request against a
 * business's pooled wallet.
 *
 * This is the one workspace write whose success MOVES MONEY (an approval writes an attributable ledger
 * line), so two properties are the service's and are not re-implemented here: the decider must actually
 * hold `approve_spend`, and an already-decided request comes back `409` — a double-click must never
 * approve the same spend twice, and idempotency belongs beside the row, not beside the parser.
 *
 * **No server-side capability guard** — approver authority is the fat service's decision, and the Dev
 * Context Switcher must reach the approvals queue as a simulated vault role. Deferred `finance.*` RLS is
 * the real gate.
 */

/**
 * The payload contract, declared LOCALLY: the SSOT carries an input schema for every payload-bearing
 * mutation, but this is a bare id + decision tuple whose fat signature takes positional arguments, so an
 * SSOT schema would imply a domain shape that does not exist.
 */
const BodySchema = z.object({
	workspaceId: z.string().min(1, "Which workspace?").max(64),
	requestId: z.string().min(1, "Which request?").max(64),
	approve: z.boolean(),
});

export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = BodySchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Invalid spend decision.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(
			WorkspaceBackendService.decideSpend(
				parsed.data.workspaceId,
				parsed.data.requestId,
				parsed.data.approve,
				viewer,
			),
		);
	},
});
