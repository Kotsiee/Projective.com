import { page } from "fresh";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import { define } from "@web/utils/state.ts";
import { resolveSchedulePage } from "@web/features/calendar/core/calendar-ssr.ts";
import { viewerFromState } from "@web/features/calendar/core/viewer.ts";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";
import ViewStyleAnchor from "@web/features/view/islands/ViewStyleAnchor.island.tsx";

/**
 * `/view/[entity]/schedule` — the session-based service schedule view: the entity's recurring
 * class/session slots (with attendee counters) + bookable 1:1 windows, rendered by the reusable
 * `@projective/ui/calendar` engine. Thin route: resolve the schedule server-side (the fat
 * {@link ScheduleBackendService.entitySchedule}, no HTTP hop) + set SEO, then hand off to the
 * {@link ScheduleView} island. `[entity]` is the item id (matching the sibling viewer).
 */
export const handler = define.handlers({
	GET(ctx) {
		const { page: schedule } = resolveSchedulePage(ctx.params.entity, viewerFromState(ctx.state));
		ctx.state.title = schedule
			? `${schedule.title} · Schedule · Projective`
			: "Schedule · Projective";
		if (schedule?.subtitle) ctx.state.description = schedule.subtitle;
		return page({ schedule });
	},
});

export default define.page<typeof handler>(function EntitySchedulePage({ data, params }) {
	const schedule = data.schedule;
	const backHref = `/view/${params.entity}`;

	/*
	 * The unavailable state used to be a bare `<p class="cal-surface__empty">` — and that class had no
	 * rule in the CSSOM on this branch, because the calendar sheet rides the `ScheduleView` island this
	 * branch does not render. So it was an unstyled sentence with no title, no icon, no back link and
	 * no next action. `ViewStyleAnchor` carries the sheets; `EmptyState` carries the shape; the action
	 * gets the reader back to the thing they were looking at.
	 */
	if (!schedule) {
		return (
			<section class="view-schedule view-schedule--empty" aria-label="Schedule">
				<ViewStyleAnchor />
				<div class="view-schedule__head">
					<a class="view-schedule__back" href={backHref}>
						<Icon name="arrow-left" size="sm" class="vw__back-arrow" />
						<span>Back to the listing</span>
					</a>
				</div>
				<EmptyState
					title="No schedule published yet"
					description="This provider hasn’t opened any session times. You can still message them to arrange one."
					actions={
						<a
							class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded"
							href={backHref}
						>
							<span class="ui-button__label">Back to the listing</span>
						</a>
					}
				/>
			</section>
		);
	}

	return (
		<section class="view-schedule" aria-label="Schedule">
			<div class="view-schedule__head">
				<a class="view-schedule__back" href={backHref}>
					<Icon name="arrow-left" size="sm" class="vw__back-arrow" />
					<span>Back to {schedule.title}</span>
				</a>
				<h1 class="view-schedule__title">{schedule.title} — Schedule</h1>
				{schedule.subtitle ? <p class="view-schedule__sub">{schedule.subtitle}</p> : null}
			</div>
			<ScheduleView scope="schedule" entityId={params.entity} initial={schedule} />
		</section>
	);
});
