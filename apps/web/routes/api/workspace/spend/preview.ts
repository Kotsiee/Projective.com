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
 * `POST /api/workspace/spend/preview` — thin route: refuse a guest, Zod-validate a DRAFT spend-policy
 * patch (the same body `POST /api/workspace/spend` saves), then delegate to the fat
 * {@link WorkspaceBackendService.previewSpend}. Answers the envelopes the draft would produce
 * (`finance.preview_spend_envelope`, `manage_finances` only) and writes nothing, so the Spend editor
 * never renders a draft ceiling against stale figures (BUSINESSES_AUDIT BD2).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpdateSpendInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.previewSpend(parsed.data, actor));
	},
});
