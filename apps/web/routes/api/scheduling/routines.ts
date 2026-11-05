import { define } from "@web/utils/state.ts";
import {
	CreateRoutineInputSchema,
	OrganiseEntryInputSchema,
	UpdateRoutineInputSchema,
} from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `/api/scheduling/routines` — the caller's own routines (Decision #389): `POST` creates one on their
 * schedule, `PATCH` changes one or archives it (`isActive: false`; there is no `DELETE`, a routine is
 * never deleted), and `PUT` organises one entry and its series: which routine it is in, and whether it
 * holds its time. An entry's own edit reaches the same door through `/api/scheduling/events`.
 *
 * Thin: guard that somebody is signed in, Zod-validate, delegate to the fat
 * {@link ScheduleBackendService}, map the result. The page read carries the list, so there is no `GET`.
 */
const SIGN_IN = () =>
	Response.json({ ok: false, message: "Sign in to change your calendar." }, { status: 401 });

function invalid(message: string, error: Parameters<typeof toFieldErrors>[0]): Response {
	return Response.json({ ok: false, message, errors: toFieldErrors(error) }, { status: 422 });
}

export const handler = define.handlers({
	async POST(ctx) {
		if (!ctx.state.isAuthenticated) return SIGN_IN();
		const parsed = CreateRoutineInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid("That routine could not be created.", parsed.error);
		return toSchedulingResponse(
			await ScheduleBackendService.createRoutine(parsed.data, readActor(ctx)),
		);
	},

	async PATCH(ctx) {
		if (!ctx.state.isAuthenticated) return SIGN_IN();
		const parsed = UpdateRoutineInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid("That change could not be saved.", parsed.error);
		return toSchedulingResponse(
			await ScheduleBackendService.updateRoutine(parsed.data, readActor(ctx)),
		);
	},

	async PUT(ctx) {
		if (!ctx.state.isAuthenticated) return SIGN_IN();
		const parsed = OrganiseEntryInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid("That entry could not be organised.", parsed.error);
		return toSchedulingResponse(
			await ScheduleBackendService.organiseEntry(parsed.data, readActor(ctx)),
		);
	},
});
