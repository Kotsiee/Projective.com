import type { JSX } from "preact";
import { EntityCard } from "@features/explore/components/cards/EntityCard.tsx";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { ExploreItem } from "@projective/types/explore";

/**
 * RelatedRail — a titled, horizontally-scrolling rail of explore cards (Part 3.1/3.2): "More by this
 * creator" and "Similar & recommended". It reuses the discovery {@link EntityCard} switch so each item
 * renders in its native card, inside the `.ex` token context the cards expect. Scroll-snaps on
 * overflow; renders nothing when there are no items.
 */
export function RelatedRail(
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
	return (
		<section class="vw-rail ex" aria-label={title}>
			<div class="vw-rail__head">
				<div class="vw-rail__heading">
					<h2 class="vw-rail__title">{title}</h2>
					{subtitle ? <p class="vw-rail__sub">{subtitle}</p> : null}
				</div>
				{seeAllHref ? <a class="vw-rail__all" href={seeAllHref}>See all →</a> : null}
			</div>
			<ul class="vw-rail__track" role="list">
				{items.map((item) => (
					<li key={item.id} class="vw-rail__cell">
						<EntityCard item={item} ctx={ctx} authed={authed} />
					</li>
				))}
			</ul>
		</section>
	);
}
