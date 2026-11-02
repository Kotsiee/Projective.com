import { define } from "@web/utils/state.ts";
import {
	CreateEntriesInputSchema,
	RemoveEntryInputSchema,
	UpdateEntryInputSchema,
} from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `/api/scheduling/events` — the caller's OWN `/calendar` entries (Decision #328 (a)):
 * `POST` creates (one, or a daily series in one write), `PATCH` edits one, `DELETE ?eventId=` takes
 * one off the calendar (archived, never deleted).
 *
 * Thin: guard that somebody is signed in, Zod-validate, delegate to the fat
 * {@link ScheduleBackendService}, map the result. The no-past-create rule, the host-only gate on
 * edit and delete, and the soft removal all live in the service, which writes as the caller under
 * RLS. Signed-in only, for the reason `./rsvp.ts` gives: the sibling GET reads are public.
 */
const SIGN_IN = () =>
	Response.json({ ok: false, message: "Sign in to change your calendar." }, { status: 401 });

function invalid(message: string, error: Parameters<typeof toFieldErrors>[0]): Response {
	return Response.json({ ok: false, message, errors: toFieldErrors(error) }, { status: 422 });
}

export const handler = define.handlers({
	async POST(ctx) {
		if (!ctx.state.isAuthenticated) return SIGN_IN();
		const parsed = CreateEntriesInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid("That entry could not be created.", parsed.error);
		return toSchedulingResponse(
			await ScheduleBackendService.createEntries(parsed.data, readActor(ctx)),
		);
	},

	async PATCH(ctx) {
		if (!ctx.state.isAuthenticated) return SIGN_IN();
		const parsed = UpdateEntryInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid("That change could not be saved.", parsed.error);
		return toSchedulingResponse(
			await ScheduleBackendService.updateEntry(parsed.data, readActor(ctx)),
		);
	},

	async DELETE(ctx) {
		if (!ctx.state.isAuthenticated) return SIGN_IN();
		const parsed = RemoveEntryInputSchema.safeParse({
			eventId: ctx.url.searchParams.get("eventId") ?? undefined,
		});
		if (!parsed.success) return invalid("Choose an entry to delete.", parsed.error);
		return toSchedulingResponse(
			await ScheduleBackendService.removeEntry(parsed.data, readActor(ctx)),
		);
	},
});
