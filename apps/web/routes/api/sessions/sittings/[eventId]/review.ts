import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SessionReviewInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/sittings/[eventId]/review` `{ happened }` — an attendee says whether a sitting
 * with no attendance record happened (Decision #383, ruling R6). The door moves no money: a yes is
 * evidence the next sweep releases on, and a no is an ordinary no-show claim.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.eventId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown session." }, { status: 404 });
		}
		const parsed = SessionReviewInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Say whether it happened." }, { status: 422 });
		}
		return toProjectsResponse(
			await SessionBackendService.answerReview(id, parsed.data.happened, readActor(ctx)),
		);
	},
});
