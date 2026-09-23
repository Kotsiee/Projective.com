import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ApplyMediaSchema } from "@projective/types/profile";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `POST /api/profile/:handle/media` — put one of the caller's library assets on the profile: as the
 * profile photo, or into one showcase slot. Body: {@link ApplyMediaSchema} (the target, the slot, the
 * library asset and the editor's crop). The fat {@link ProfileBackendService.applyMedia} cuts a
 * public rendition in the media pipeline and the definer RPC decides whether it may go on this
 * profile; the answer is the profile's media as now stored.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to edit your profile." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, ApplyMediaSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.applyMedia(ctx.params.handle, body.data, actor),
		);
	},
});
