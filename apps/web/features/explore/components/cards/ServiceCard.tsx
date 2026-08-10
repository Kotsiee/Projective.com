import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { servicePriceParts, servicePricing } from "../../core/pricing.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ServiceItem } from "../../types/explore-types.ts";

/**
 * ServiceCard — a fixed-price, buy-now service in the responsive grid. Deliberately lean (title king):
 * a wide 16:10 media thumbnail carrying one glass engagement-type chip (Pipeline / One-Off / Session),
 * then the title, a single owner+rating byline, and an unambiguous price/turnaround footer. The former
 * category tag, in-body type eyebrow, description snippet, and skill-tag row were dropped to the detail
 * view — on a dense grid they added height and noise without discriminating between similar results.
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
	const pricing = servicePricing(item);
	// Structured minor units when the item carries them; the pre-formatted string stays the fallback
	// for a listing that has none ("Contact us"), which must never become a confident zero.
	const parts = servicePriceParts(item);
	return (
		<article class="ex-card ex-card--service" style={vars({ "--ex-accent": cardAccent(item.id) })}>
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} by ${item.owner.name} — ${item.price}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />
			<div class="ex-media ex-media--16x10">
				<img src={item.media} alt="" loading="lazy" decoding="async" />
				<span class="ex-flags">
					{item.sponsored && <PromotedBadge />}
					<span class="ex-media__type" data-type={item.serviceType}>{item.serviceType}</span>
				</span>
			</div>
			<div class="ex-card__body">
				<h3 class="ex-card__title">{item.title}</h3>
				<div class="ex-card__byline">
					<OwnerBadge owner={item.owner} variant="mini" />
					{review && <RatingStars value={review.value} count={review.count} size="sm" compact />}
				</div>
				<div class="ex-card__foot">
					<span class="ex-price ex-price--lg">
						{
							/*
						  Structured money when the item carries it — so the figure follows the viewer's
						  display currency (the CurrencyBridge re-projects it live; this card is a server
						  component with no island of its own). A Pipeline renders TWO MoneyViews around an
						  en dash rather than one pre-joined string, because a range is two amounts and each
						  has to convert independently. `hideOrigin` on the low end: one origin disclosure
						  per range is the fact, two is noise.
						*/
						}
						{parts
							? (
								<>
									<MoneyView
										minor={parts.from.minor}
										currency={parts.from.currency}
										hideOrigin={parts.to !== null}
									/>
									{parts.to && (
										<>
											{" – "}
											<MoneyView
												minor={parts.to.minor}
												currency={parts.to.currency}
											/>
										</>
									)}
								</>
							)
							: pricing.amount}
						{pricing.unit && <span class="ex-price__unit">/ {pricing.unit}</span>}
					</span>
					<span class="ex-muted">{item.delivery}</span>
				</div>
			</div>
		</article>
	);
}
