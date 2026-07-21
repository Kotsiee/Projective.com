import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveSchedulePage } from "@web/features/calendar/core/calendar-ssr.ts";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";

/**
 * `/view/[entity]/schedule` — the session-based service schedule view: the entity's recurring
 * class/session slots (with attendee counters) + bookable 1:1 windows, rendered by the reusable
 * `@projective/ui/calendar` engine. Thin route: resolve the schedule server-side (the fat
 * {@link ScheduleBackendService.entitySchedule}, no HTTP hop) + set SEO, then hand off to the
 * {@link ScheduleView} island. `[entity]` is the item id (matching the sibling viewer).
 */
export const handler = define.handlers({
	GET(ctx) {
		const { page: schedule } = resolveSchedulePage(ctx.params.entity);
		ctx.state.title = schedule ? `${schedule.title} · Schedule · Projective` : "Schedule · Projective";
		if (schedule?.subtitle) ctx.state.description = schedule.subtitle;
		return page({ schedule });
	},
});

export default define.page<typeof handler>(function EntitySchedulePage({ data, params }) {
	const schedule = data.schedule;
	if (!schedule) {
		return <p class="cal-surface__empty">This schedule isn’t available.</p>;
	}
	return (
		<section class="view-schedule" aria-label="Schedule">
			<div class="view-schedule__head">
				<a class="view-schedule__back" href={`/view/${params.entity}`}>← Back to {schedule.title}</a>
				<h1 class="view-schedule__title">{schedule.title} — Schedule</h1>
				{schedule.subtitle ? <p class="view-schedule__sub">{schedule.subtitle}</p> : null}
			</div>
			<ScheduleView scope="schedule" entityId={params.entity} initial={schedule} />
		</section>
	);
});
