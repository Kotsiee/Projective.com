import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { servicePricing } from "../../core/pricing.ts";
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
					{review && (
						<RatingStars value={review.value} count={review.count} size="sm" compact />
					)}
				</div>
				<div class="ex-card__foot">
					<span class="ex-price ex-price--lg">
						{pricing.amount}
						{pricing.unit && <span class="ex-price__unit">/ {pricing.unit}</span>}
					</span>
					<span class="ex-muted">{item.delivery}</span>
				</div>
			</div>
		</article>
	);
}
