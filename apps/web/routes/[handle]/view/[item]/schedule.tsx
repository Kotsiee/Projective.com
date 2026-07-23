import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveSchedulePage } from "@web/features/calendar/core/calendar-ssr.ts";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";

/**
 * `/[handle]/view/[item]/schedule` — the profile-scoped session-schedule leaf: the entity's recurring
 * class/session slots (with attendee counters) + bookable 1:1 windows, rendered by the reusable
 * `@projective/ui/calendar` engine. The profile-namespace mirror of the public
 * `/view/[id]/schedule` (they share the fat {@link ScheduleBackendService.entitySchedule}); the only
 * difference is the handle-scoped back link. Reached from the Entity View action lane's
 * "Book a session" CTA for Session-format services.
 */
export const handler = define.handlers({
	GET(ctx) {
		const { page: schedule } = resolveSchedulePage(ctx.params.item);
		ctx.state.title = schedule
			? `${schedule.title} · Schedule · Projective`
			: "Schedule · Projective";
		if (schedule?.subtitle) ctx.state.description = schedule.subtitle;
		return page({ schedule, handle: ctx.params.handle, item: ctx.params.item });
	},
});

export default define.page<typeof handler>(function ProfileEntitySchedulePage({ data }) {
	const schedule = data.schedule;
	if (!schedule) {
		return <p class="cal-surface__empty">This schedule isn’t available.</p>;
	}
	return (
		<section class="view-schedule" aria-label="Schedule">
			<div class="view-schedule__head">
				<a class="view-schedule__back" href={`/${data.handle}/view/${data.item}`}>
					← Back to {schedule.title}
				</a>
				<h1 class="view-schedule__title">{schedule.title} — Schedule</h1>
				{schedule.subtitle ? <p class="view-schedule__sub">{schedule.subtitle}</p> : null}
			</div>
			<ScheduleView scope="schedule" entityId={data.item} initial={schedule} />
		</section>
	);
});
