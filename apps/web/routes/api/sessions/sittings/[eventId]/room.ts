import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SittingRoomInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/sittings/[eventId]/room` `{ link }` — a link the host adds to a sitting with no
 * room (Decision #383, rulings R2 and R7). The door decides who may, and nothing here moves money.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.eventId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown session." }, { status: 404 });
		}
		const parsed = SittingRoomInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Join links must start with https://." }, { status: 422 });
		}
		return toProjectsResponse(
			await SessionBackendService.setRoomLink(id, parsed.data.link, readActor(ctx)),
		);
	},
});
