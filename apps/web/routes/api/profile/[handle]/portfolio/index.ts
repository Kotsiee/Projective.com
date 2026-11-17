import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SavePortfolioPieceSchema } from "@projective/types/profile";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `POST /api/profile/:handle/portfolio` — create or edit one of a freelancer's portfolio pieces.
 * Body: {@link SavePortfolioPieceSchema} (no `id` is a new piece, which needs a cover). A new cover is
 * cut from the caller's library asset in the media pipeline and the definer RPC decides whether the
 * piece may go on this profile; the answer is the owner's whole portfolio as now stored.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to edit your profile." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, SavePortfolioPieceSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.savePortfolioPiece(ctx.params.handle, body.data, actor),
		);
	},
});
