import { define } from "@web/utils/state.ts";
import { page } from "fresh";
import { calendarAgendaFor } from "@features/calendar/core/calendar-slots.tsx";
import { readActor } from "@web/utils/api-session.ts";
import CalendarWorkspace from "@features/calendar/islands/CalendarWorkspace.island.tsx";

/**
 * `/calendar` — the acting account's own agenda.
 *
 * The BODY is the grid and nothing else. The mini-month, the upcoming list and the availability
 * manager are the middle-nav lane's; the identity, the period trail, the search and the filter entry
 * are the header band's; every action is the footer band's. All three are resolved per-URL in
 * `(dashboard)/_layout.tsx` through `calendar-slots.tsx`, so the correct chrome ships in the first
 * byte rather than appearing after hydration.
 *
 * The agenda is read AS the signed-in person, under RLS, through the same per-request read the three
 * bands use, so the grid and the chrome around it are one answer rather than two.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const agenda = await calendarAgendaFor(ctx.url, readActor(ctx));
		ctx.state.title = "Calendar · Projective";
		return page({ agenda });
	},
});

export default define.page<typeof handler>(function CalendarPage({ data }) {
	return <CalendarWorkspace initial={data.agenda} />;
});
