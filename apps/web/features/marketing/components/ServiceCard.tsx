import type { JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display";
import { OwnerBadge } from "@features/explore/components/OwnerBadge.tsx";
import { type ServiceShowcase } from "../core/landing-data.ts";

/**
 * ServiceCard — a fixed-price, buy-now service offering in the landing carousel.
 *
 * This renders the CANONICAL discovery card contract (`.ex-card--service`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-service` block. The landing page and the search feed show the same object, so a change to card
 * separation, hover, focus, clamping, or the overlay-chip treatment lands on both surfaces from one
 * place.
 *
 * The bands are the family's: media (16:10) → creator row → title → classification row → foot. The
 * classification row carries the category, with the turnaround in its right-aligned secondary slot.
 *
 * The whole card is one route action via the stretched `.ex-card__link`, and the owner's avatar and
 * `@handle` stay independently clickable above it. Zero client JS; hydration lives in the parent
 * carousel island.
 */
export function ServiceCard({ service }: { service: ServiceShowcase }): JSX.Element {
	return (
		<article class="ex-card ex-card--service">
			<a
				class="ex-card__link"
				href={`/view/${service.slug}?type=services`}
				aria-label={`${service.title} by ${service.owner.name} — ${service.price}`}
			/>
			<div class="ex-media ex-media--16x10">
				<ProgressiveImage
					src={service.thumb}
					placeholder={service.thumbPlaceholder}
					loading="lazy"
				/>
			</div>
			<div class="ex-card__body">
				<OwnerBadge owner={service.owner} variant="creator" />
				<h3 class="ex-card__title">{service.title}</h3>
				<div class="ex-card__kindrow">
					<span class="ex-kind">{service.category}</span>
					<span class="ex-card__aside">{service.delivery}</span>
				</div>
				<div class="ex-card__foot">
					<span />
					<span class="ex-pricebadge">
						<span class="ex-pricebadge__amount">{service.price}</span>
					</span>
				</div>
			</div>
		</article>
	);
}
