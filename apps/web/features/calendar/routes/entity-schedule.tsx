import { page } from "fresh";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import { define } from "@web/utils/state.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import ViewStyleAnchor from "@web/features/view/islands/ViewStyleAnchor.island.tsx";
import { warmCatalog } from "@server/services/explore/live-catalog.ts";
import { restrictBooking } from "../core/booking-gate.ts";
import { resolveSchedulePage } from "../core/calendar-ssr.ts";
import { viewerFromState } from "../core/viewer.ts";
import ScheduleView from "../islands/ScheduleView.island.tsx";

/**
 * The session-based service schedule leaf: the entity's recurring class/session slots (with attendee
 * counters) + bookable 1:1 windows, rendered by the reusable `@projective/ui/calendar` engine.
 * Mounted at two addresses that differ only in the namespace of the back link:
 *
 * - `/view/[entity]/schedule` — the public leaf (`[entity]` is the item id, matching the viewer).
 * - `/[handle]/view/[item]/schedule` — the profile-namespace mirror, reached from the Entity View
 *   action lane's "Book a session" CTA for Session-format services.
 *
 * Thin controller: resolve the schedule server-side (the fat
 * {@link ScheduleBackendService.entitySchedule}, no HTTP hop) + set SEO, then hand off to the
 * {@link ScheduleView} island.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { handle, item, entity } = ctx.params;
		const entityId = item ?? entity;
		// The service below resolves the listing synchronously from the loaded catalogue.
		await warmCatalog();
		const { page: resolved } = await resolveSchedulePage(entityId, viewerFromState(ctx.state));
		// An under-18 viewer books nothing with anyone (Decision #208).
		const schedule = restrictBooking(resolved, isRestrictedRequest(ctx.req, ctx.state.userContext));
		ctx.state.title = schedule
			? `${schedule.title} · Schedule · Projective`
			: "Schedule · Projective";
		if (schedule?.subtitle) ctx.state.description = schedule.subtitle;
		const backHref = handle ? `/${handle}/view/${entityId}` : `/view/${entityId}`;
		return page({ schedule, entityId, backHref });
	},
});

export default define.page<typeof handler>(function EntitySchedulePage({ data }) {
	const { schedule, entityId, backHref } = data;

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
						<Icon name="arrow-left" size="sm" aria-hidden />
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

	/*
	 * `ViewStyleAnchor` is load-bearing on THIS branch too, not only the empty one: the calendar
	 * island carries the engine's own sheets and nothing else, so without the anchor the leaf's back
	 * link, title and gutters shipped with zero rules — a default blue underlined anchor flush against
	 * the viewport edge above a fully styled calendar. Measured before the mount existed.
	 */
	return (
		<section class="view-schedule" aria-label="Schedule">
			<ViewStyleAnchor />
			<div class="view-schedule__head">
				<a class="view-schedule__back" href={backHref}>
					<Icon name="arrow-left" size="sm" aria-hidden />
					<span>Back to {schedule.title}</span>
				</a>
				<p class="view-schedule__eyebrow">Schedule</p>
				<h1 class="view-schedule__title">{schedule.title}</h1>
				{schedule.subtitle ? <p class="view-schedule__sub">{schedule.subtitle}</p> : null}
			</div>
			<ScheduleView scope="schedule" entityId={entityId} initial={schedule} />
		</section>
	);
});
