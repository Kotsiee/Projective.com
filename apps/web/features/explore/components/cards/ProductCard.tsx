import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProductItem } from "../../types/explore-types.ts";

/**
 * ProductCard — a ready-to-buy digital product for the staggered masonry. Media-forward: the image's
 * own intrinsic ratio drives the tile's height in the column flow, which is what makes the masonry
 * interlock. The price rides the media as an overlay chip rather than a foot, so the body stays a
 * three-band read — category, title, owner + rating.
 *
 * The tile carried an `ex-card--span{n}` class for its supposed "column weight". No stylesheet has ever
 * defined that class, so it did nothing; the staggering has always come from the intrinsic image ratio.
 * Removed rather than left as a claim the CSS does not honour.
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
		<article class="ex-card ex-card--product">
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} by ${item.owner.name} — ${item.price}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />
			<div class="ex-media">
				<img src={item.media} alt="" loading="lazy" decoding="async" />
				<span class="ex-flags">
					{item.sponsored && <PromotedBadge />}
					<span class="ex-media__price">
						{typeof item.priceMinor === "number"
							? <MoneyView minor={item.priceMinor} currency={item.currency ?? "USD"} />
							: item.price}
					</span>
				</span>
			</div>
			<div class="ex-card__body">
				<span class="ex-eyebrow">{item.category}</span>
				<h3 class="ex-card__title ex-card__title--sm">{item.title}</h3>
				<div class="ex-card__byline">
					<OwnerBadge owner={item.owner} variant="mini" />
					{review && <RatingStars value={review.value} count={review.count} size="sm" compact />}
				</div>
			</div>
		</article>
	);
}
