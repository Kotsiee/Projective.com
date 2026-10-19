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
 * `POST /api/workspace/spend-withdraw` — thin route: refuse a guest, validate the request id, then
 * delegate to the fat {@link WorkspaceBackendService.withdrawSpend} to take back the caller's own
 * pending spend request (`finance.withdraw_spend_approval`, Decision #246).
 *
 * Who may withdraw is the database's: only the member who filed the request, only while it waits. A
 * second click is refused there too (already withdrawn), so nothing here guards against it.
 *
 * The payload contract is declared LOCALLY, as `spend-decide`'s is: a bare id pair the fat service
 * takes as-is.
 */
const BodySchema = z.object({
	workspaceId: z.string().min(1, "Which workspace?").max(64),
	requestId: z.string().min(1, "Which request?").max(64),
});

export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = BodySchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid spend request.");
		return toWorkspaceResponse(await WorkspaceBackendService.withdrawSpend(parsed.data, actor));
	},
});
