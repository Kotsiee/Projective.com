import type { JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import "@features/explore/styles/explore.css";
import "@features/explore/styles/explore-results.css";
import "../styles/view.css";
import type { EntityView } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import MediaGallery from "../islands/MediaGallery.island.tsx";
import ReviewsPanel from "../islands/ReviewsPanel.island.tsx";
import ViewBuyBar from "../islands/ViewBuyBar.island.tsx";
import ViewStyleAnchor from "../islands/ViewStyleAnchor.island.tsx";
import { ViewDetails } from "./ViewDetails.tsx";
import { RelatedSection } from "./RelatedRail.tsx";
import { ProjectViewScreen } from "./ProjectViewScreen.tsx";
import { ArticleViewScreen } from "./ArticleViewScreen.tsx";
import { ServiceViewScreen } from "./ServiceViewScreen.tsx";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";

/**
 * EntityViewScreen — the Entity View page body (`/view/[id]`). It DISPATCHES by the resolved item's
 * type: a **project** renders the custom {@link ProjectViewScreen} (profile-mirroring banner/avatar
 * chrome + interactive Stage Flow; no rails/reviews) and an **article** the custom
 * {@link ArticleViewScreen} (editorial body + media carousel + comments; the TOC lives in the side nav).
 * Everything else (services · products · profile entities) keeps the generic Amazon-style hero (media
 * showcase + overview) with the lower recommendation/reviews sections. The transactional/navigation
 * sidebar lane is resolved separately by `viewLaneFor`. Renders a calm empty state when the id resolves
 * to nothing.
 */
export function EntityViewScreen(
	{ view, ctx = { scope: "explore" }, authed = false }: {
		view: EntityView | undefined;
		ctx?: HrefContext;
		authed?: boolean;
	},
): JSX.Element {
	if (!view) {
		/*
		 * `ViewStyleAnchor` is REQUIRED here, not decorative. Every app-local sheet on this surface is
		 * delivered by the lane island, and `viewLaneFor` returns `null` for an unresolved id — so this
		 * branch used to render with zero rules in the CSSOM for `.vw`, `.vw__back`, `.ui-empty` or
		 * `.ex-btn`. The one call to action computed to a bare inline link. The anchor now carries the
		 * page sheets, so the state that most needs a working next action has one.
		 */
		return (
			<div class="vw vw--empty">
				<ViewStyleAnchor />
				<div class="vw__back-row">
					<a class="vw__back" href={backHrefFor(ctx)}>
						<Icon name="arrow-left" size="sm" class="vw__back-arrow" />
						<span>{backLabelFor(ctx)}</span>
					</a>
				</div>
				{
					/* An anchor, not a `Button` — this navigates, so it keeps middle-click, "open in new
				    tab" and the correct role. It wears the package's own button classes rather than a
				    local re-declaration of button geometry (§B.9.6's server-rendered escape hatch); the
				    sheet rides `ViewStyleAnchor`. */
				}
				<EmptyState
					title="Item not found"
					description="This item may have been removed, or the link is out of date. Explore live work to find something similar."
					actions={
						<a
							class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded"
							href="/explore"
						>
							<span class="ui-button__label">Explore Projective</span>
						</a>
					}
				/>
			</div>
		);
	}

	// Custom per-type templates. Projects and articles bypass the generic hero/rails/reviews entirely;
	// services keep the commercial rails/reviews but add the delivery-model-aware showcase + stage flow.
	if (view.project) {
		return <ProjectViewScreen view={view} project={view.project} ctx={ctx} authed={authed} />;
	}
	if (view.article) {
		return <ArticleViewScreen view={view} article={view.article} ctx={ctx} authed={authed} />;
	}
	if (view.service) {
		return <ServiceViewScreen view={view} service={view.service} ctx={ctx} authed={authed} />;
	}

	const { item, gallery, moreByOwner, similar, reviews } = view;
	const ownerFirst = item.owner.name.split(/\s+/)[0] ?? item.owner.name;

	return (
		<div class="vw">
			<ViewStyleAnchor />

			{/* Mobile-only: on desktop the side-nav lane header carries Back (hidden via `--laned`). */}
			<div class="vw__back-row vw__back-row--laned">
				<a class="vw__back" href={backHrefFor(ctx)}>
					<Icon name="arrow-left" size="sm" class="vw__back-arrow" />
					<span>{backLabelFor(ctx)}</span>
				</a>
			</div>

			{/* Hero: media showcase (left) + entity overview (right). */}
			<div class="vw-hero">
				<MediaGallery gallery={gallery} title={item.title} />
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

			{/* Lower body sections. */}
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
