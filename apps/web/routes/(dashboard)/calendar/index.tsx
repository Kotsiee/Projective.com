import { define } from "@web/utils/state.ts";
import { page } from "fresh";
import { schedulingSimFromParams } from "@projective/types/scheduling";
import { resolvePersonalCalendar } from "@features/calendar/core/calendar-ssr.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import CalendarWorkspace from "@features/calendar/islands/CalendarWorkspace.island.tsx";

/**
 * `/calendar` — the acting account's own agenda.
 *
 * The BODY is the grid and nothing else. The mini-month, the upcoming list and the availability
 * manager are the middle-nav lane's; the identity, the period trail, the search and the filter entry
 * are the header band's; every action is the footer band's. All three are resolved per-URL in
 * `(dashboard)/_layout.tsx` through `calendar-slots.tsx`, so the correct chrome ships in the first
 * byte rather than appearing after hydration.
 */
export const handler = define.handlers({
	GET(ctx) {
		const { page: agenda } = resolvePersonalCalendar(
			viewerFromState(ctx.state),
			schedulingSimFromParams(ctx.url.searchParams),
		);
		ctx.state.title = "Calendar · Projective";
		return page({ agenda });
	},
});

export default define.page<typeof handler>(function CalendarPage({ data }) {
	return <CalendarWorkspace initial={data.agenda} />;
});
