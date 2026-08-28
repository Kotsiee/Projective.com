import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import { StatusChip } from "../StatusChip.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { ratingSignals } from "../../core/card-signals.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProductItem } from "../../types/explore-types.ts";

/**
 * ProductCard — a ready-to-buy digital product in the staggered masonry.
 *
 * Anatomy is the service card's, deliberately: creator row, two-line title, category chip, then the
 * rating bottom-left and the price bottom-right. A buyer comparing a service against a product is
 * comparing two purchases, and two purchases should be read the same way. The price moved off the
 * image and into the foot for the same reason — it was the only price in the family floating on a
 * photograph, so it was the only one whose legibility depended on what the seller uploaded.
 *
 * The ONE thing that stays product-specific is the media frame: its height is content-driven, which is
 * what makes the masonry interlock. It is bounded by a `max-block-size` rather than an `aspect-ratio`,
 * so a portrait and a landscape asset can both keep their proportions without either running away with
 * the column.
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
	const signals = ratingSignals(item.rating);

	return (
		<article
			class="ex-card ex-card--product"
			data-item-id={item.id}
			data-item-type={item.type}
			data-ambient-src={item.media}
			style={vars({ "--ex-accent": cardAccent(item.id) })}
		>
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} by ${item.owner.name} — ${item.price}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />

			<div class="ex-media ex-media--free">
				<img src={item.media} alt="" loading="lazy" decoding="async" />
				{signals.length > 0 && (
					<span class="ex-signals">
						{signals.map((s) => <StatusChip signal={s} key={s.id} />)}
					</span>
				)}
				{item.sponsored && <PromotedBadge />}
			</div>

			<div class="ex-card__body">
				<OwnerBadge owner={item.owner} variant="creator" />

				<h3 class="ex-card__title ex-card__title--sm">{item.title}</h3>

				<div class="ex-card__kindrow">
					<span class="ex-kind">{item.category}</span>
				</div>

				<div class="ex-card__foot">
					{review
						? (
							<span class="ex-ratingpill">
								<RatingStars value={review.value} count={review.count} size="sm" compact />
							</span>
						)
						: <span />}

					{
						/* One line, no unit: a product is a fixed purchase and has nothing to be priced PER.
						   It shares the service card's price container so the two read at the same weight
						   in a mixed rail, and `hideOrigin` matches the service card's decision to keep the
						   conversion tail off a card foot — `MoneyView` still names the origin and the rate
						   in its accessible label. */
					}
					<span class="ex-pricebadge">
						<span class="ex-pricebadge__amount">
							{typeof item.priceMinor === "number"
								? (
									<MoneyView
										minor={item.priceMinor}
										currency={item.currency ?? "USD"}
										hideOrigin
									/>
								)
								: item.price}
						</span>
					</span>
				</div>
			</div>
		</article>
	);
}
