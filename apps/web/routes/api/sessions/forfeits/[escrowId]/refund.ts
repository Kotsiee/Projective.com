import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { OrderBackendService } from "@server/services/finance/OrderBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/forfeits/[escrowId]/refund` — the provider gives a forfeited seat or sitting back
 * in full (FBP DB21; ruling M8, voluntary). Thin: the id's shape, then
 * {@link OrderBackendService.refundForfeit}, which passes the money switch and calls
 * `finance.refund_session_forfeit` as the signed-in caller; the door decides whose forfeit it is.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.escrowId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown session." }, { status: 404 });
		}
		return toProjectsResponse(await OrderBackendService.refundForfeit(id, readActor(ctx)));
	},
});
