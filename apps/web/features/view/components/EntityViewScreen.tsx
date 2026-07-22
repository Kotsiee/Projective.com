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
import { RelatedRail } from "./RelatedRail.tsx";
import { backHrefFor, backLabelFor, ENTITY_LABEL } from "../core/view-model.ts";

/**
 * EntityViewScreen — the public Entity View page body (`/view/[id]`). It lays out the Amazon-style
 * hero (a media showcase gallery beside the entity overview column) and the lower body sections (more
 * by the creator · similar & recommended · the full reviews section). The transactional sidebar action
 * panel lives in the navigation lane, resolved separately by `viewLaneFor` — this is just the content
 * region. Renders a calm empty state when the id resolves to nothing.
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

	const { item, gallery, moreByOwner, similar, reviews } = view;
	const ownerFirst = item.owner.name.split(/\s+/)[0] ?? item.owner.name;

	return (
		<div class="vw">
			<ViewStyleAnchor />

			<div class="vw__back-row">
				<a class="vw__back" href={backHrefFor(ctx)}>← {backLabelFor(ctx)}</a>
			</div>

			{/* Hero: media showcase (left) + entity overview (right). */}
			<div class="vw-hero">
				<MediaGallery gallery={gallery} title={item.title} />
				<ViewDetails view={view} />
			</div>

			{/* Lower body sections. */}
			<div class="vw-body">
				<RelatedRail
					title={`More by ${item.owner.name}`}
					subtitle={`Other ${ENTITY_LABEL[item.type].toLowerCase()}s and work from ${ownerFirst}`}
					items={moreByOwner}
					ctx={ctx}
					authed={authed}
					seeAllHref={`/${item.owner.handle}`}
				/>

				<RelatedRail
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
