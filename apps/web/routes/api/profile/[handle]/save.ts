import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ProfileSavePatchSchema } from "@projective/types/profile";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `POST /api/profile/:handle/save` — save the owner-editable fields. Body: a
 * {@link ProfileSavePatchSchema} patch (only the sections that changed). Zod-validated here for a
 * field-keyed answer; the fat {@link ProfileBackendService.save} resolves the profile from the HANDLE
 * and the definer RPC behind it re-checks that the caller manages it and every hard limit.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to edit your profile." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, ProfileSavePatchSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(await ProfileBackendService.save(ctx.params.handle, body.data, actor));
	},
});
