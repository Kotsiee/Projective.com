import type { JSX } from "preact";
import { OwnerBadge } from "@features/explore/components/OwnerBadge.tsx";
import { ownerForHandle } from "../core/showcase-owner.ts";
import { type ServiceShowcase } from "../core/landing-data.ts";

/**
 * ServiceCard — a fixed-price, buy-now service offering in the landing carousel.
 *
 * This renders the CANONICAL discovery card contract (`.ex-card--service`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-service` block. The landing page and the search feed now show the same object, so a change to
 * card separation, hover, focus, clamping, or the overlay-chip treatment lands on both surfaces from
 * one place. The former `.lp-service` rules were a fork that had drifted behind on reduced-motion,
 * focus treatment, and chip legibility.
 *
 * The bands are the family's: media (16:10) → creator row → title → classification row → foot.
 * Marketing's fixtures carry no `serviceType`, so the classification chip falls back to the category
 * and the turnaround takes the row's right-aligned secondary slot.
 *
 * The whole card is one route action via the stretched `.ex-card__link`, and the owner's avatar and
 * `@handle` stay independently clickable above it. Zero client JS; hydration lives in the parent
 * carousel island.
 */
export function ServiceCard({ service }: { service: ServiceShowcase }): JSX.Element {
	return (
		<article class="ex-card ex-card--service">
			{
				/* `routes.service()` pointed at `/services/:slug`, which has no public route and 404'd on
			    every landing service card. The canonical discovery destination is `/view/:id`. */
			}
			<a
				class="ex-card__link"
				href={`/view/${service.slug}?type=services`}
				aria-label={`${service.title} by ${service.provider} — ${service.price}`}
			/>
			<div class="ex-media ex-media--16x10">
				<img src={service.thumb} alt="" loading="lazy" decoding="async" />
			</div>
			<div class="ex-card__body">
				<OwnerBadge owner={ownerForHandle(service.providerHandle)} variant="creator" />
				<h3 class="ex-card__title">{service.title}</h3>
				<div class="ex-card__kindrow">
					<span class="ex-kind">{service.category}</span>
					<span class="ex-card__aside">{service.delivery}</span>
				</div>
				<div class="ex-card__foot">
					<span />
					<span class="ex-pricebadge">{service.price}</span>
				</div>
			</div>
		</article>
	);
}
