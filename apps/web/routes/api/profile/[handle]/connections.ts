import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toProfileResponse } from "@features/profile/core/respond.ts";
import { invalidFields } from "@web/utils/service-response.ts";
import { ProfileConnectionsParamsSchema } from "@projective/types/profile";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `GET /api/profile/:handle/connections?direction=followers|following&cursor=` — one page of the people
 * behind the profile's follower / following counts. Public, like the follow edge itself. Answers the
 * profile envelope `{ ok, data: { items, nextCursor } }`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const q = ctx.url.searchParams;
		const parsed = ProfileConnectionsParamsSchema.safeParse({
			direction: q.get("direction"),
			cursor: q.get("cursor") ?? undefined,
		});
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return toProfileResponse(
			await ProfileBackendService.connections(ctx.params.handle, parsed.data, readActor(ctx)),
		);
	},
});
