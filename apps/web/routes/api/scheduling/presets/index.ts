import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { SavePresetInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/presets` — the acting owner's live availability presets.
 * `PUT /api/scheduling/presets` — save one ({@link ScheduleBackendService.savePreset}): written,
 * compiled for the booking gate and, for the default, mirrored into the weekly bands.
 *
 * Thin: the age gate first (no scheduling for 13–17-year-olds, Decision #208), then the session, then
 * Zod; the service re-validates every rule with the evaluator and answers a hard issue as a 422.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		return toSchedulingResponse(await ScheduleBackendService.presets(readActor(ctx)));
	},

	async PUT(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to manage your availability." }, {
				status: 401,
			});
		}
		const parsed = SavePresetInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Check the highlighted rules.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		return toSchedulingResponse(await ScheduleBackendService.savePreset(parsed.data, actor));
	},
});
