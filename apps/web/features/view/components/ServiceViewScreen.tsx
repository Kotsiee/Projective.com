import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import "../styles/view.css";
import type { EntityView, ServiceViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { resolveSchedulePage } from "@web/features/calendar/core/calendar-ssr.ts";
import ServiceShowcase from "../islands/ServiceShowcase.island.tsx";
import ReviewsPanel from "../islands/ReviewsPanel.island.tsx";
import ViewBuyBar from "../islands/ViewBuyBar.island.tsx";
import StageFlow from "../islands/StageFlow.island.tsx";
import ViewStyleAnchor from "../islands/ViewStyleAnchor.island.tsx";
import { ViewDetails } from "./ViewDetails.tsx";
import { RelatedSection } from "./RelatedRail.tsx";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";

/**
 * ServiceViewScreen — the custom **Services** view template body (`/view/[id]?type=services`), covering
 * all five delivery models via the resolved {@link ServiceViewExtra}:
 *
 * - The hero pairs the {@link ServiceShowcase} (media gallery, or — for Session / Group Session — the
 *   availability-calendar toggle) with the {@link ViewDetails} overview (which also renders the Direct
 *   Deliverable "Project Team Roles" block).
 * - **Pipeline / One-Off** additionally render the Stage Showcase — the same {@link StageFlow} the
 *   Projects view uses — with per-stage deliverables, turnaround, and dependencies.
 * - The commercial lower body (More by creator · Similar · Reviews) is kept (unlike the Projects view).
 *
 * A session-format service's schedule is resolved server-side here (no HTTP hop) so the calendar
 * first-paints when toggled. The transactional side-nav lane (with the `pf-availtoggle`) is resolved
 * separately by `viewLaneFor`.
 */
export function ServiceViewScreen(
	{ view, service, ctx, authed }: {
		view: EntityView;
		service: ServiceViewExtra;
		ctx: HrefContext;
		authed: boolean;
	},
): JSX.Element {
	const { item, gallery, moreByOwner, similar, reviews } = view;
	const ownerFirst = item.owner.name.split(/\s+/)[0] ?? item.owner.name;

	// Session / Group Session resolve their schedule up front so the calendar paints on first toggle.
	const schedule = service.bookable ? resolveSchedulePage(item.id).page : null;

	return (
		<div class="vw vw-service">
			<ViewStyleAnchor />

			{/* Mobile-only: on desktop the side-nav lane header carries Back (hidden via `--laned`). */}
			<div class="vw__back-row vw__back-row--laned">
				<a class="vw__back" href={backHrefFor(ctx)}>
					<Icon name="arrow-left" size="sm" class="vw__back-arrow" />
					<span>{backLabelFor(ctx)}</span>
				</a>
			</div>

			{/* Hero: showcase (media ⁄ availability) left + entity overview right. */}
			<div class="vw-hero">
				<ServiceShowcase
					gallery={gallery}
					title={item.title}
					bookable={service.bookable}
					group={service.group}
					schedule={schedule}
					entityId={item.id}
				/>
				<ViewDetails view={view} />
			</div>

			{/* ≤767px only — the lane is `display:none` there and it owns the whole transaction. */}
			<ViewBuyBar
				item={item}
				pricing={view.pricing}
				trust={view.trust}
				authed={authed}
				ctx={ctx}
			/>

			{/* Stage showcase — Pipeline / One-Off only, mirroring the Projects view. */}
			{service.showcaseStages && service.stages.length > 0
				? (
					<section class="vw-project__stages vw-service__stages">
						<div class="vw-project__stageshead">
							<h2 class="vw-h2">
								{service.model === "pipeline" ? "How this pipeline works" : "Delivery milestones"}
							</h2>
							<p class="vw-project__stageshint">
								{service.model === "pipeline"
									? "A staged workflow billed per ticket. Expand a stage for its deliverables, turnaround, dependencies, and skills."
									: "A milestone-based delivery. Expand a milestone for its deliverables, turnaround, dependencies, and skills."}
							</p>
						</div>
						<StageFlow stages={service.stages} title={item.title} />
					</section>
				)
				: null}

			{/* Commercial lower body. */}
			<div class="vw-body">
				<RelatedSection
					title={`More by ${item.owner.name}`}
					subtitle={`More work from ${ownerFirst}, grouped by type`}
					items={moreByOwner}
					ctx={ctx}
					authed={authed}
					seeAllHref={`/${item.owner.handle}`}
				/>

				<RelatedSection
					title="Similar & recommended"
					subtitle="Comparable options other clients considered"
					items={similar}
					ctx={ctx}
					authed={authed}
				/>

				<ReviewsPanel summary={reviews.summary} list={reviews.list} />
			</div>
		</div>
	);
}
