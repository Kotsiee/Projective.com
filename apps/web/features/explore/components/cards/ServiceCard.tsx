import type { JSX } from "preact";
import { RatingStars, Tag } from "@projective/ui/display";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import { SkillPills } from "../SkillPill.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ServiceItem } from "../../types/explore-types.ts";

/**
 * ServiceCard — a fixed-price, buy-now service in the responsive grid. Leads with a photographic media
 * thumbnail + category tag, then the engagement type (Pipeline / One-Off / Session), owner
 * attribution, its review rating, a description snippet, and an unambiguous price/turnaround footer.
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
	return (
		<article class="ex-card ex-card--service" style={vars({ "--ex-accent": cardAccent(item.id) })}>
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} by ${item.owner.name} — ${item.price}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />
			<div class="ex-media ex-media--4x3">
				<img src={item.media} alt="" loading="lazy" decoding="async" />
				<div class="ex-media__tag">
					<Tag value={item.category} variant="subtle" rounded />
				</div>
			</div>
			<div class="ex-card__body">
				<span class="ex-eyebrow ex-service__type" data-type={item.serviceType}>
					{item.serviceType}
				</span>
				<h3 class="ex-card__title">{item.title}</h3>
				<OwnerBadge owner={item.owner} variant="mini" />
				{review && <RatingStars value={review.value} count={review.count} size="sm" />}
				<p class="ex-service__desc">{item.summary}</p>
				<SkillPills skills={item.skills} max={2} />
				<div class="ex-card__foot">
					<span class="ex-price ex-price--lg">{item.price}</span>
					<span class="ex-muted">{item.delivery}</span>
				</div>
			</div>
		</article>
	);
}
