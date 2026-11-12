import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { calendarAgendaFor, calendarPresetsFor } from "../core/calendar-slots.tsx";
import { calendarModeOf, presetSlugOf } from "../core/availability-view.ts";
import { readCalendarAddress } from "../core/calendar-address.ts";
import CalendarWorkspace from "../islands/CalendarWorkspace.island.tsx";
import AvailabilityStudio from "../islands/AvailabilityStudio.island.tsx";

/**
 * `/calendar` — the acting account's own agenda, and with `?view=availability` its availability
 * templates on a full page (Decision #376).
 *
 * The agenda's view is addressed as `?view=&date=&zoom=&kind=` (Decision #413): read here, so the
 * first byte paints the asked-for period, and a value the agenda does not answer is a 303 to the
 * canonical address with it dropped.
 *
 * The BODY is the grid, or the scheduler, and nothing else. The lane, the header band (identity and
 * the Agenda ⇄ Availability switch), the footer band and the panel are resolved per-URL in
 * `(dashboard)/_layout.tsx` through `calendar-slots.tsx`, so the correct chrome for either mode ships
 * in the first byte rather than appearing after hydration.
 *
 * Both reads are made AS the signed-in person, under RLS, through the same per-request read their
 * bands use, so the body and the chrome around it are one answer rather than two. An under-18
 * account has no availability to manage (Decision #208), so its availability address answers the
 * agenda.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { address, redirect } = readCalendarAddress(ctx.url, "personal");
		if (redirect) return new Response(null, { status: 303, headers: { location: redirect } });
		const actor = readActor(ctx);
		if (calendarModeOf(ctx.url) === "availability") {
			if (isRestrictedRequest(ctx.req, ctx.state.userContext)) {
				return new Response(null, { status: 303, headers: { location: "/calendar" } });
			}
			ctx.state.title = "Availability · Calendar · Projective";
			return page({
				mode: "availability" as const,
				presets: await calendarPresetsFor(ctx.url, actor),
				presetSlug: presetSlugOf(ctx.url),
				locale: ctx.state.userContext?.locale,
				// The schedule belongs to whoever is acted as, so the local draft is kept per owner.
				owner: actor.contextId || actor.userId,
			});
		}
		const agenda = await calendarAgendaFor(ctx.url, actor);
		ctx.state.title = "Calendar · Projective";
		return page({ mode: "agenda" as const, agenda, address });
	},
});

export default define.page<typeof handler>(function CalendarPage({ data }) {
	return data.mode === "availability"
		? (
			<AvailabilityStudio
				initial={data.presets}
				presetSlug={data.presetSlug}
				locale={data.locale}
				owner={data.owner}
			/>
		)
		: <CalendarWorkspace initial={data.agenda} address={data.address} />;
});
