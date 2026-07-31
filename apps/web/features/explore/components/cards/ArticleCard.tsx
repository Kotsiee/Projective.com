import type { JSX } from "preact";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ArticleItem, ExploreItem } from "../../types/explore-types.ts";

/**
 * ArticleCard — a help/editorial article for the grid/list combo section. Descriptive thumbnail, a
 * topic eyebrow, the headline, and an author + read-time byline. The `orientation` prop switches
 * between the media-on-top grid tile and the media-beside list row (same markup, CSS-driven).
 *
 * The byline uses the family's `.ex-card__byline` row rather than a bare `OwnerBadge`, so attribution
 * composes identically to a service or product card. Read time moved out of the eyebrow — where it was
 * middot-joined to the topic — into the byline's trailing slot, the position a service card gives its
 * rating. That leaves the eyebrow to carry one fact and gives the article the same four-band rhythm as
 * the rest of the family.
 *
 * Articles ALWAYS navigate straight to their standalone page — they deliberately IGNORE `onSelect`, so
 * they never open the Search Results side-drawer (an article is a read, not a preview).
 */
export function ArticleCard(
	{ item, ctx = { scope: "explore" }, orientation = "grid", authed = false }: {
		item: ArticleItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		orientation?: "grid" | "list";
		authed?: boolean;
	},
): JSX.Element {
	return (
		<article class={`ex-card ex-card--article ex-card--article-${orientation}`}>
			<CardLink item={item} ctx={ctx} label={item.title} />
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />
			<div class="ex-media">
				<img src={item.media} alt="" loading="lazy" decoding="async" />
			</div>
			<div class="ex-card__body">
				<span class="ex-eyebrow">{item.topic}</span>
				<h3 class="ex-card__title ex-card__title--sm">{item.title}</h3>
				<div class="ex-card__byline">
					<OwnerBadge owner={item.owner} variant="mini" />
					<span class="ex-muted">{item.readMinutes} min read</span>
				</div>
			</div>
		</article>
	);
}
