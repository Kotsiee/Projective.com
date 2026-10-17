import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfPayoutNotReady } from "@web/utils/payout-gate.ts";
import { refuseIfSimulatedOperator } from "@web/utils/operator-mode.ts";
import { CreateWorkspaceInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceBody,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { respondWithReissuedSession } from "@web/utils/session.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/create` — thin route: refuse a guest, Zod-validate the Draft-First payload (kind +
 * name + handle), then delegate to the fat {@link WorkspaceBackendService.create}, which creates the
 * entity with the caller as its owner. A `201` with `{ id, kind, handle }` — the caller navigates into
 * the new console, which is addressed by its handle and resolves its own detail.
 *
 * The handle is re-validated server-side even though the form probes `/api/workspace/handle` first — the
 * probe is an affordance, not a lock, and two people can pass it for the same handle in the same second.
 * The plan's creation cap is the database's decision, refused with a human reason.
 *
 * A created business re-issues the session ({@link respondWithReissuedSession}): the token carries the
 * account facts the shell gates Businesses and Create Business on (`belongsToBusiness`,
 * `businessHeadroom`), and the owner's new seat and spent allowance must reach the chrome now rather
 * than at the next hourly refresh.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = CreateWorkspaceInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		if (parsed.data.kind === "team") {
			const operator = refuseIfSimulatedOperator(ctx.req);
			if (operator) return operator;
			const unpayable = refuseIfPayoutNotReady(ctx.req);
			if (unpayable) return unpayable;
		}
		const result = await WorkspaceBackendService.create(parsed.data, actor);
		if (!result.ok || parsed.data.kind !== "business") return toWorkspaceResponse(result);
		return respondWithReissuedSession(ctx.req, toWorkspaceBody(result), result.status);
	},
});
