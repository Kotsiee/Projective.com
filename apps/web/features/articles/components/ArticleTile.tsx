import type { JSX } from "preact";
import {
	EDITORIAL_ARTICLE_TOPIC_LABEL,
	type EditorialArticleCard,
} from "@projective/types/editorial";
import { readTimeLabel, shortArticleDate } from "../core/article-format.ts";
import { articleHref } from "../core/index-query.ts";
import { ArticleMeta } from "./ArticleMeta.tsx";

/** The tile's size: the index's lead story, a feature, a grid tile, or a compact related row. */
export type ArticleTileVariant = "lead" | "feature" | "grid" | "compact";

/** Props for {@link ArticleTile}. */
export interface ArticleTileProps {
	card: EditorialArticleCard;
	variant: ArticleTileVariant;
	/** The title's heading level under the page's outline. */
	level: 2 | 3;
	/**
	 * Load the cover eagerly at high priority — the page's largest paint (the index's lead story).
	 * Every other tile's cover is lazy and fades in.
	 */
	priority?: boolean;
}

/**
 * ArticleTile — one article as an interactive media card (DESIGN_SYSTEM §B.9.5): the cover, the
 * primary topic, the title, the standfirst (not on a compact row) and one Meta-register line —
 * byline · reading time · date. The title's link is the tile's only control; its overlay makes the
 * whole card the target, so a screen reader hears one link named by the title, not a card of links.
 * The cover keeps its box from the first byte (width/height plus an aspect ratio on a solid tone).
 */
export function ArticleTile(
	{ card, variant, level, priority = false }: ArticleTileProps,
): JSX.Element {
	const Heading = level === 2 ? "h2" : "h3";
	return (
		<article class={`artl-tile artl-tile--${variant}`}>
			<div class="artl-tile__media">
				<img
					class="artl-tile__img"
					src={card.cover.src}
					alt={card.cover.alt}
					width={card.cover.w}
					height={card.cover.h}
					decoding="async"
					loading={priority ? "eager" : "lazy"}
					fetchpriority={priority ? "high" : undefined}
					data-artl-fade={priority ? undefined : ""}
				/>
			</div>
			<div class="artl-tile__body">
				<p class="artl-tile__eyebrow">{EDITORIAL_ARTICLE_TOPIC_LABEL[card.topics[0]]}</p>
				<Heading class="artl-tile__title">
					<a class="artl-tile__link" href={articleHref(card.slug)}>{card.title}</a>
				</Heading>
				{variant === "compact" ? null : <p class="artl-tile__standfirst">{card.standfirst}</p>}
				<ArticleMeta
					facts={[
						variant === "compact" ? null : card.authorName,
						readTimeLabel(card.readMinutes),
						<time key="date" dateTime={card.publishedAt}>{shortArticleDate(card.publishedAt)}
						</time>,
					]}
				/>
			</div>
		</article>
	);
}
