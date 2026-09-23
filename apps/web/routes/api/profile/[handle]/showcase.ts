import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SaveShowcaseSchema } from "@projective/types/profile";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `PUT /api/profile/:handle/showcase` — replace the whole six-slot showcase grid (empty a slot, move
 * items between slots, edit alt text). Body: {@link SaveShowcaseSchema}. Every file must already be
 * one of this profile's showcase renditions — the definer RPC checks each one, and that slot 1 is a
 * still — so a grid can only ever be rearranged from what the pipeline produced.
 */
export const handler = define.handlers({
	async PUT(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to edit your profile." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, SaveShowcaseSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.saveShowcase(ctx.params.handle, body.data, actor),
		);
	},
});
