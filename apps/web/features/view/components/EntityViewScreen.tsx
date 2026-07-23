import type { JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import "@features/explore/styles/explore.css";
import "@features/explore/styles/explore-results.css";
import "../styles/view.css";
import type { EntityView } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import MediaGallery from "../islands/MediaGallery.island.tsx";
import ReviewsPanel from "../islands/ReviewsPanel.island.tsx";
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
		return (
			<div class="vw">
				<div class="vw__back-row">
					<a class="vw__back" href={backHrefFor(ctx)}>← {backLabelFor(ctx)}</a>
				</div>
				<EmptyState
					title="Item not found"
					description="This item may have been removed or the link is out of date."
					actions={<a class="ex-btn ex-btn--solid" href="/explore">Explore Projective</a>}
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
				<a class="vw__back" href={backHrefFor(ctx)}>← {backLabelFor(ctx)}</a>
			</div>

			{/* Hero: media showcase (left) + entity overview (right). */}
			<div class="vw-hero">
				<MediaGallery gallery={gallery} title={item.title} />
				<ViewDetails view={view} />
			</div>

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
