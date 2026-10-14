import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { ArchivePresetInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/scheduling/presets/archive` — archive a preset, never delete it
 * ({@link ScheduleBackendService.archivePreset}). The listings bound to it fall back to the default
 * preset and come back as `data.rebound`. Age gate (Decision #208), session, Zod, service.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to manage your availability." }, {
				status: 401,
			});
		}
		const parsed = ArchivePresetInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Choose a preset to archive.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		return toSchedulingResponse(await ScheduleBackendService.archivePreset(parsed.data.id, actor));
	},
});
