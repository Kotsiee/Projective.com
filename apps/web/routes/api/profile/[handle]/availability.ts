import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { SaveOwnerAvailabilitySchema } from "@projective/types/scheduling";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `GET /api/profile/:handle/availability` — the OWNER's schedule and call settings, as the editor
 * is seeded (a draft included), weekly hours with them. `PUT` saves the time zone, publishing and
 * call settings in one transaction and keeps the weekly hours, which only the default availability
 * template writes (Decision #408). Body: {@link SaveOwnerAvailabilitySchema}, so a body carrying
 * bands has them stripped. Owner-only both ways: the fat {@link ProfileBackendService}
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
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to manage availability." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, SaveOwnerAvailabilitySchema);
		if (!body.ok) return body.response;
		return toProfileResponse(
			await ProfileBackendService.saveAvailability(ctx.params.handle, body.data, actor),
		);
	},
});
