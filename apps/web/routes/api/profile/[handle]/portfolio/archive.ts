import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ArchivePortfolioPieceSchema } from "@projective/types/profile";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `POST /api/profile/:handle/portfolio/archive` — take one portfolio piece off the profile. Body:
 * {@link ArchivePortfolioPieceSchema}. The piece is archived, never deleted, and its cover retired;
 * the answer is the owner's whole portfolio as now stored.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to edit your profile." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, ArchivePortfolioPieceSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.archivePortfolioPiece(ctx.params.handle, body.data.id, actor),
		);
	},
});
