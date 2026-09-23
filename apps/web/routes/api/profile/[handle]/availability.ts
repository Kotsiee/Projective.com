import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { OwnerAvailabilitySchema } from "@projective/types/scheduling";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `GET /api/profile/:handle/availability` — the OWNER's schedule and call settings, as the editor
 * is seeded (a draft included). `PUT` saves the whole editor value in one transaction. Body:
 * {@link OwnerAvailabilitySchema}. Owner-only both ways: the fat {@link ProfileBackendService}
 * refuses anyone the database does not say manages the profile, and the scheduling policies refuse
 * them again underneath it.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to manage availability." }, { status: 401 });
		}
		const res = toProfileResponse(await ProfileBackendService.availability(ctx.params.handle, actor));
		res.headers.set("Cache-Control", "private, no-store");
		return res;
	},
	async PUT(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to manage availability." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, OwnerAvailabilitySchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.saveAvailability(ctx.params.handle, body.data, actor),
		);
	},
});
