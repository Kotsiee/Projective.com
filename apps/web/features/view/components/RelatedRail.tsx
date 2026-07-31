import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { ExploreItem } from "@projective/types/explore";
import { type EntityGroup, groupItemsByType } from "../core/view-model.ts";
import RelatedCarousel from "../islands/RelatedCarousel.island.tsx";

/**
 * The most single-type blocks one recommendation section may render.
 *
 * The cross-sell measured 73% of total page height — two sections, each fanning out into up to five
 * labelled blocks. The height came from the number of BLOCKS, not the number of items: a carousel pages,
 * so items are free, while every extra block adds a label and a full row. Two blocks keeps a section's
 * "more of the same, plus one adjacent thing" shape and bounds it; the rest is one click away behind
 * "See all". `groupItemsByType` already orders transactional formats first, so the survivors are the
 * commercially useful ones.
 */
const MAX_GROUPS = 2;

/**
 * RelatedSection — a titled recommendation section ("More by this creator" / "Similar & recommended",
 * Part 3.1/3.2) whose items are grouped by entity type, capped at {@link MAX_GROUPS} blocks. Every
 * format now renders through the reusable {@link Carousel} (`@projective/ui/display`) via
 * {@link RelatedCarousel}, including products: the staggered masonry is right on Explore, where products
 * ARE the feed, but in a cross-sell footnote it was the one block whose height nothing bounded. Each
 * item keeps its native discovery {@link EntityCard}, inside the `.ex` token context the cards expect.
 * Renders nothing when there are no items.
 */
export function RelatedSection(
	{ title, subtitle, items, ctx, authed, seeAllHref, columns }: {
		title: string;
		subtitle?: string;
		items: ExploreItem[];
		ctx: HrefContext;
		authed: boolean;
		seeAllHref?: string;
		/** Cards per row — a host rendering into a narrow column passes a lower count. */
		columns?: number;
	},
): JSX.Element | null {
	if (items.length === 0) return null;
	const groups = groupItemsByType(items).slice(0, MAX_GROUPS);
	// With a single format the section title already names it — the per-block label would be redundant.
	const showGroupLabels = groups.length > 1;

	/*
	 * The section is NOT `.ex`. That class is the Explore PAGE root — `explore.css` says so in its own
	 * header — and carries `min-block-size: 100vh` plus `background: var(--surface)`. It was used here
	 * purely to inherit the `--ex-*` card tokens, and those moved to `:root` when the card system was
	 * unified. What was left behind was a **one-viewport floor on every recommendation section**:
	 * measured, each of the two sections stood at exactly 900px in a 900px window while its real content
	 * was 439px and 786px. That single stray class was the largest contributor to the cross-sell owning
	 * 73% of the page.
	 */
	return (
		<section class="vw-related" aria-label={title}>
			<div class="vw-related__head">
				<div class="vw-related__heading">
					<h2 class="vw-related__title">{title}</h2>
					{subtitle ? <p class="vw-related__sub">{subtitle}</p> : null}
				</div>
				{seeAllHref
					? (
						<a class="vw-related__all" href={seeAllHref}>
							<span>See all</span>
							<Icon name="arrow-right" size="xs" class="vw-related__allarrow" />
						</a>
					)
					: null}
			</div>

			<div class="vw-related__groups">
				{groups.map((group) => (
					<RelatedGroup
						key={group.type}
						group={group}
						ctx={ctx}
						authed={authed}
						showLabel={showGroupLabels}
						columns={columns}
					/>
				))}
			</div>
		</section>
	);
}

/**
 * RelatedGroup — one single-type block, always a {@link RelatedCarousel} (`@projective/ui/display`
 * {@link Carousel}). One idiom per section means the reader learns the interaction once instead of
 * scanning a rail, then a masonry, then a rail down a page a third of a screen tall.
 */
function RelatedGroup(
	{ group, ctx, authed, showLabel, columns }: {
		group: EntityGroup;
		ctx: HrefContext;
		authed: boolean;
		showLabel: boolean;
		columns?: number;
	},
): JSX.Element {
	return (
		<div class="vw-group" data-type={group.type}>
			{showLabel ? <h3 class="vw-group__label">{group.label}</h3> : null}
			<RelatedCarousel
				items={group.items}
				ctx={ctx}
				authed={authed}
				kind={group.type}
				label={group.label}
				columns={columns}
			/>
		</div>
	);
}
