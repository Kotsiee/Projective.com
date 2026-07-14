import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProductItem } from "../../types/explore-types.ts";

/**
 * ProductCard — a ready-to-buy digital product for the staggered masonry. Media-forward (the `span`
 * drives its height in the column flow), with a floating price chip, owner attribution, and its review
 * rating beneath.
 */
export function ProductCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ProductItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const review = item.rating?.asHelper ?? item.rating?.asClient;
	return (
		<article class={`ex-card ex-card--product ex-card--span${item.span}`}>
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} by ${item.owner.name} — ${item.price}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />
			<div class="ex-media">
				<img src={item.media} alt="" loading="lazy" decoding="async" />
				<span class="ex-media__price">{item.price}</span>
			</div>
			<div class="ex-card__body">
				<span class="ex-eyebrow">{item.category}</span>
				<h3 class="ex-card__title ex-card__title--sm">{item.title}</h3>
				<OwnerBadge owner={item.owner} variant="mini" />
				{review && <RatingStars value={review.value} count={review.count} size="sm" />}
			</div>
		</article>
	);
}
