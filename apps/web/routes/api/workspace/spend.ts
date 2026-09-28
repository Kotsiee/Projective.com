import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateSpendInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/spend` — thin route: refuse a guest, Zod-validate a BUSINESS's pooled-wallet
 * governance (currency · approval threshold · approvers · contributors · per-member envelopes), then
 * delegate to the fat {@link WorkspaceBackendService.updateSpend}.
 *
 * Every amount is an integer in MINOR units of the policy's `currency`, straight from the SSOT schema,
 * and the route performs no arithmetic on one. The threshold is at least one minor unit or `null` (off)
 * — `0` would mean "every spend needs approval" to one reader and "disabled" to another, so the schema
 * does not admit it.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpdateSpendInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.updateSpend(parsed.data, actor));
	},
});
