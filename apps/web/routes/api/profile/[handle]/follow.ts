import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/** The follow toggle's body — the state the caller wants, so a repeated press is idempotent. */
const FollowSchema = z.object({ follow: z.boolean() });

/**
 * `POST /api/profile/:handle/follow` — follow or unfollow the profile as the caller. Body:
 * `{ follow: boolean }`. Answers with the follower count as it now stands.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to follow." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, FollowSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.follow(ctx.params.handle, body.data.follow, actor),
		);
	},
});
