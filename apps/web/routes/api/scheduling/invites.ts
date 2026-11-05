import { define } from "@web/utils/state.ts";
import { InviteInputSchema, WithdrawInviteInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `/api/scheduling/invites` — a host's guest list for one of their own entries. `POST` seats people
 * and tells them; `DELETE ?eventId=&attendeeId=` withdraws one invitation. Each answers with the entry
 * re-read. Answering an invitation is `/api/scheduling/rsvp`, the door every seat answers by.
 *
 * Thin: guard that somebody is signed in, Zod-validate, delegate to the fat
 * {@link ScheduleBackendService}, map the result. Whose entry it is, and whether it can take a guest,
 * are the database door's to say.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to invite people." }, { status: 401 });
		}
		const parsed = InviteInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those invitations could not be sent.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toSchedulingResponse(await ScheduleBackendService.invite(parsed.data, readActor(ctx)));
	},

	async DELETE(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json(
				{ ok: false, message: "Sign in to withdraw an invitation." },
				{ status: 401 },
			);
		}
		const url = new URL(ctx.req.url);
		const parsed = WithdrawInviteInputSchema.safeParse({
			eventId: url.searchParams.get("eventId"),
			attendeeId: url.searchParams.get("attendeeId"),
		});
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That invitation could not be withdrawn.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toSchedulingResponse(
			await ScheduleBackendService.withdrawInvitation(parsed.data, readActor(ctx)),
		);
	},
});
