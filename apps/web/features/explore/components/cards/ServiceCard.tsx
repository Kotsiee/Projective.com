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
import { ratingSignals, serviceTypeLabel } from "../../core/card-signals.ts";
import { serviceStartingPrice } from "../../core/pricing.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ServiceItem } from "../../types/explore-types.ts";

/**
 * ServiceCard — a bookable service in the discovery grid.
 *
 * Anatomy: a 16:10 media frame carrying the earned trust chips (top-left) and the paid-placement
 * disclosure (top-right); a creator row naming the seller directly under the image; the title, clamped
 * to two lines; the delivery-model chip with the turnaround right-aligned beside it; then a foot that
 * splits the star rating from the price.
 *
 * The PRICE is one figure in a two-line stack — `From £120.00` over a muted `/ ticket` — never a range
 * and never a converted-plus-origin pair. See the block comment at the call site for what that trades
 * away and where the full range still lives.
 *
 * The creator row moved ABOVE the title and now prints the seller's NAME rather than their handle.
 * On a marketplace the answer to "who is selling this" is a person or a studio, and a handle is an
 * address, not an identity — the reader had to decode `@northwind` into "Northwind Studio" themselves.
 *
 * The type chip moved off the image and into the body. On the media it competed with the trust chips
 * for the same corner and had to be legible over arbitrary photography; in the body it sits on a known
 * surface, can hold the turnaround beside it, and leaves the image to the two overlays that genuinely
 * have to float.
 */
export function ServiceCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ServiceItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const review = item.rating?.asHelper ?? item.rating?.asClient;
	// One figure, never a range, and never a conversion tail — see the price block below.
	const price = serviceStartingPrice(item);
	const signals = ratingSignals(item.rating);

	return (
		<article
			class="ex-card ex-card--service"
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

			<div class="ex-media ex-media--16x10">
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

				<h3 class="ex-card__title">{item.title}</h3>

				<div class="ex-card__kindrow">
					<span class="ex-kind" data-type={item.serviceType}>
						{serviceTypeLabel(item.serviceType)}
					</span>
					{
						/*
						 * The brief's example for this slot is "Recently Viewed", which needs per-viewer
						 * browsing history the discovery corpus does not carry — so the slot holds a real
						 * secondary fact instead of a fabricated one. See the note in the summary.
						 */
					}
					{item.delivery && <span class="ex-card__aside">{item.delivery}</span>}
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
						/*
					  The price, as a two-line vertical stack: the figure on top in the card's heaviest
					  weight, the unit beneath it small and muted.

					  ONE FIGURE, and no conversion tail. The card used to render a Pipeline as a
					  converted RANGE with its origin disclosed — `From £94.49 – £377.95 (~US$480.00 USD)
					  / ticket` — which is four numbers and two currencies for a glance that is only ever
					  asked to answer "roughly how much". `hideOrigin` suppresses the visible disclosure
					  only: `MoneyView` still names the origin and the rate in the accessible label and
					  the `title`, so the fact that the figure is converted is not destroyed, just moved
					  off a line that could not carry it. The full range stays on `/view/[id]` and in the
					  search drawer.

					  Structured minor units when the item carries them, so the figure follows the
					  viewer's display currency (this is a server component with no island of its own —
					  the CurrencyBridge re-projects it). The pre-formatted string is the fallback for a
					  listing with no structured price ("Contact us"), which must never become a
					  confident zero.
					*/
					}
					<span class="ex-pricebadge">
						<span class="ex-pricebadge__amount">
							{price.isFloor && <span class="ex-pricebadge__from">From&#32;</span>}
							{price.amount
								? (
									<MoneyView
										minor={price.amount.minor}
										currency={price.amount.currency}
										hideOrigin
									/>
								)
								: price.fallback}
						</span>
						{price.unit && <span class="ex-pricebadge__unit">/ {price.unit}</span>}
					</span>
				</div>
			</div>
		</article>
	);
}
