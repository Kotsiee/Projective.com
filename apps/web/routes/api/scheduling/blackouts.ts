import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { BlackoutInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/scheduling/blackouts` — book whole days off on the acting owner's schedule
 * ({@link ScheduleBackendService.addBlackout}). `DELETE /api/scheduling/blackouts?id=` — remove one
 * ({@link ScheduleBackendService.removeBlackout}). Both answer the schedule's settings as they now
 * stand. Age gate (Decision #208), session, Zod, service.
 */
const IdSchema = z.uuid();

function signIn(): Response {
	return Response.json({ ok: false, message: "Sign in to manage your availability." }, {
		status: 401,
	});
}

export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const actor = readActor(ctx);
		if (!actor.userId) return signIn();
		const parsed = BlackoutInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			const errors = toFieldErrors(parsed.error);
			return Response.json(
				{ ok: false, message: Object.values(errors)[0] ?? "Check the dates.", errors },
				{ status: 422 },
			);
		}
		return toSchedulingResponse(await ScheduleBackendService.addBlackout(parsed.data, actor));
	},

	async DELETE(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const actor = readActor(ctx);
		if (!actor.userId) return signIn();
		const id = IdSchema.safeParse(ctx.url.searchParams.get("id"));
		if (!id.success) {
			return Response.json({ ok: false, message: "Choose the time off to remove." }, {
				status: 400,
			});
		}
		return toSchedulingResponse(await ScheduleBackendService.removeBlackout(id.data, actor));
	},
});
