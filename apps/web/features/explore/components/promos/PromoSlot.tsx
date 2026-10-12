import type { JSX } from "preact";
import { Avatar, ProgressiveImage } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import { RailHeading } from "../RailHeading.tsx";
import type {
	CtaPromo,
	EditorialPromo,
	PromoSlot as PromoSlotModel,
	SponsoredPromo,
} from "../../types/explore-types.ts";

/**
 * PromoSlot — the one reserved promo surface on the Explore Home, in three variants: `sponsored` (a
 * paid placement, featured as a two-cell `RailCell` inside its rail), `cta` (a conversion invitation)
 * and `editorial` (a titled list of help reads).
 *
 * Every variant sits on solid `--surface-1`, titles at the rail-heading register, and reflows between
 * stacked and two columns on its container's width rather than the viewport's. The paid-placement
 * disclosure is the card family's AD badge, so a sponsored slot and a sponsored card disclose alike.
 */
export function PromoSlot({ slot }: { slot: PromoSlotModel }): JSX.Element {
	switch (slot.variant) {
		case "sponsored":
			return <SponsoredVariant slot={slot} />;
		case "cta":
			return <CtaVariant slot={slot} />;
		case "editorial":
			return <EditorialVariant slot={slot} />;
	}
}

function SponsoredVariant({ slot }: { slot: SponsoredPromo }): JSX.Element {
	return (
		<a class="ex-promo ex-promo--sponsored" href={slot.href} aria-label={`Sponsored: ${slot.title}`}>
			<div class="ex-media ex-media--16x10 ex-promo__media">
				<ProgressiveImage src={slot.media} placeholder={slot.mediaPlaceholder} loading="lazy" />
				<PromotedBadge />
			</div>
			<div class="ex-promo__body">
				<span class="ex-owner ex-promo__owner">
					<Avatar
						image={slot.owner.avatar}
						fallbackImage={personFallbackImage(slot.owner.kind)}
						label={slot.owner.name}
						alt=""
						size="sm"
						class="ex-owner__avatar"
					/>
					<span class="ex-owner__name">{slot.owner.name}</span>
				</span>
				<h3 class="ex-promo__title">{slot.title}</h3>
				<p class="ex-promo__text">{slot.body}</p>
				<span class="ex-cta ex-promo__foot">
					<span>{slot.cta}</span>
					<Icon name="arrow-right" aria-hidden />
				</span>
			</div>
		</a>
	);
}

function CtaVariant({ slot }: { slot: CtaPromo }): JSX.Element {
	const titleId = `ex-${slot.id}-title`;
	return (
		<section class="ex-promo ex-promo--cta" aria-labelledby={titleId}>
			<div class="ex-promo__copy">
				<span class="ex-eyebrow">{slot.eyebrow}</span>
				<h2 class="ex-promo__title" id={titleId}>{slot.title}</h2>
				<p class="ex-promo__text">{slot.body}</p>
			</div>
			<a class="ex-btn ex-btn--solid ex-promo__action" href={slot.href}>{slot.cta}</a>
		</section>
	);
}

function EditorialVariant({ slot }: { slot: EditorialPromo }): JSX.Element {
	return (
		<section class="ex-promo ex-promo--editorial" aria-labelledby={`ex-${slot.id}-title`}>
			<header class="ex-promo__head">
				<RailHeading id={slot.id} lead={slot.lead} tail={slot.tail} />
				<a class="ex-viewall" href={slot.href}>
					<span>{slot.hrefLabel}</span>
					<Icon name="arrow-right" aria-hidden />
				</a>
			</header>
			<ul class="ex-promo__list" role="list">
				{slot.articles.map((a) => (
					<li key={a.id}>
						<a class="ex-promo__link" href={a.href}>
							<span class="ex-promo__glyph" aria-hidden="true">
								<Icon name="help" />
							</span>
							<span class="ex-promo__linktext">{a.title}</span>
							<span class="ex-promo__meta">{a.minutes} min</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}
