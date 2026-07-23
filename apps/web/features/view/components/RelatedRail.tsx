import type { JSX } from "preact";
import { EntityCard } from "@features/explore/components/cards/EntityCard.tsx";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { ExploreItem } from "@projective/types/explore";
import { type EntityGroup, groupItemsByType } from "../core/view-model.ts";
import RelatedCarousel from "../islands/RelatedCarousel.island.tsx";

/**
 * RelatedSection — a titled recommendation section ("More by this creator" / "Similar & recommended",
 * Part 3.1/3.2) whose items are strictly grouped and separated by entity type. Each type renders in its
 * own dedicated block: Products keep the staggered {@link ProductsMasonry} idiom (a CSS multi-column
 * masonry), while every other format (Services, Active Projects, Articles, profiles) renders through the
 * reusable {@link Carousel} (`@projective/ui/display`) via {@link RelatedCarousel}. Both reuse the
 * discovery {@link EntityCard} switch so each item keeps its native card, inside the `.ex` token context
 * the cards expect. Renders nothing when there are no items.
 */
export function RelatedSection(
	{ title, subtitle, items, ctx, authed, seeAllHref }: {
		title: string;
		subtitle?: string;
		items: ExploreItem[];
		ctx: HrefContext;
		authed: boolean;
		seeAllHref?: string;
	},
): JSX.Element | null {
	if (items.length === 0) return null;
	const groups = groupItemsByType(items);
	// With a single format the section title already names it — the per-block label would be redundant.
	const showGroupLabels = groups.length > 1;

	return (
		<section class="vw-related ex" aria-label={title}>
			<div class="vw-related__head">
				<div class="vw-related__heading">
					<h2 class="vw-related__title">{title}</h2>
					{subtitle ? <p class="vw-related__sub">{subtitle}</p> : null}
				</div>
				{seeAllHref ? <a class="vw-related__all" href={seeAllHref}>See all →</a> : null}
			</div>

			<div class="vw-related__groups">
				{groups.map((group) => (
					<RelatedGroup
						key={group.type}
						group={group}
						ctx={ctx}
						authed={authed}
						showLabel={showGroupLabels}
					/>
				))}
			</div>
		</section>
	);
}

/**
 * RelatedGroup — one dedicated single-type block. Products render as a staggered masonry (variable-height
 * cards interlock, distinct from the carousels — a CSS multi-column flow with no library equivalent);
 * every other format renders through the {@link RelatedCarousel} island (`@projective/ui/display`
 * {@link Carousel}).
 */
function RelatedGroup(
	{ group, ctx, authed, showLabel }: {
		group: EntityGroup;
		ctx: HrefContext;
		authed: boolean;
		showLabel: boolean;
	},
): JSX.Element {
	const isProducts = group.type === "products";
	return (
		<div class="vw-group" data-type={group.type}>
			{showLabel ? <h3 class="vw-group__label">{group.label}</h3> : null}
			{isProducts
				? (
					<div class="ex-masonry vw-group__masonry" role="list" aria-label={group.label}>
						{group.items.map((item) => (
							<div class="ex-masonry__item" role="listitem" key={item.id}>
								<EntityCard item={item} ctx={ctx} authed={authed} />
							</div>
						))}
					</div>
				)
				: (
					<RelatedCarousel
						items={group.items}
						ctx={ctx}
						authed={authed}
						kind={group.type}
						label={group.label}
					/>
				)}
		</div>
	);
}
