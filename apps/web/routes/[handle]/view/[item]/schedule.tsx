import { page } from "fresh";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import { define } from "@web/utils/state.ts";
import { resolveSchedulePage } from "@web/features/calendar/core/calendar-ssr.ts";
import { viewerFromState } from "@web/features/calendar/core/viewer.ts";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";
import ViewStyleAnchor from "@web/features/view/islands/ViewStyleAnchor.island.tsx";

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
		const { page: schedule } = resolveSchedulePage(ctx.params.item, viewerFromState(ctx.state));
		ctx.state.title = schedule
			? `${schedule.title} · Schedule · Projective`
			: "Schedule · Projective";
		if (schedule?.subtitle) ctx.state.description = schedule.subtitle;
		return page({ schedule, handle: ctx.params.handle, item: ctx.params.item });
	},
});

export default define.page<typeof handler>(function ProfileEntitySchedulePage({ data }) {
	const schedule = data.schedule;
	const backHref = `/${data.handle}/view/${data.item}`;

	/* Mirrors the public `/view/[id]/schedule` unavailable state — see that route for why the style
	   anchor is load-bearing on a branch that renders no calendar island. */
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
			<ScheduleView scope="schedule" entityId={data.item} initial={schedule} />
		</section>
	);
});
