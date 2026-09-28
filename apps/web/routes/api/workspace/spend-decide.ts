import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/spend-decide` — thin route: refuse a guest, validate the decision, then delegate
 * to the fat {@link WorkspaceBackendService.decideSpend} to approve or decline an outstanding spend
 * request against a business's pooled wallet.
 *
 * The one workspace write whose success can MOVE money, so two properties are the database's and are not
 * re-implemented here: the decider must hold `approve_spend`, and an already-decided request is refused —
 * a double-click must never approve the same spend twice.
 *
 * The payload contract is declared LOCALLY: it is a bare id + decision tuple the fat service takes as-is,
 * so an SSOT schema would imply a domain shape that does not exist.
 */
const BodySchema = z.object({
	workspaceId: z.string().min(1, "Which workspace?").max(64),
	requestId: z.string().min(1, "Which request?").max(64),
	approve: z.boolean(),
});

export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = BodySchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid spend decision.");
		return toWorkspaceResponse(await WorkspaceBackendService.decideSpend(parsed.data, actor));
	},
});
