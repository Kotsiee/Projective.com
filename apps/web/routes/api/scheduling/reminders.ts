import { define } from "@web/utils/state.ts";
import { SetEntryRemindersInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `/api/scheduling/reminders` — `PUT` sets the caller's OWN alerts for one entry they hold (Decision
 * #388). `reminders: null` returns them to their default.
 *
 * Its own route rather than a field of `/api/scheduling/events`, because that door is the host's and
 * this one is every seat's: an alert is the person's, whoever runs the meeting.
 *
 * Thin: guard that somebody is signed in, Zod-validate, delegate to the fat
 * {@link ScheduleBackendService}, map the result. Which entries take alerts, and whether this person
 * is on one, are the service's and RLS's to say.
 */
export const handler = define.handlers({
	async PUT(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json(
				{ ok: false, message: "Sign in to change your reminders." },
				{ status: 401 },
			);
		}
		const parsed = SetEntryRemindersInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those reminders could not be saved.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toSchedulingResponse(
			await ScheduleBackendService.setEntryReminders(parsed.data, readActor(ctx)),
		);
	},
});
