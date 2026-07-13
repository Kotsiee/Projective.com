import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { routes, type ServiceShowcase } from "../core/landing-data.ts";

/**
 * ServiceCard — a fixed-price, buy-now service offering. The card is the route action (anchor →
 * service detail). Photographic thumb, a category tag, and an unambiguous price/turnaround footer.
 * Zero client JS; hydration lives in the parent carousel island.
 */
export function ServiceCard({ service }: { service: ServiceShowcase }): JSX.Element {
	return (
		<a
			class="lp-card lp-service"
			href={routes.service(service.slug)}
			aria-label={`${service.title} by ${service.provider} — ${service.price}`}
		>
			<div class="lp-service__media">
				<img class="lp-service__img" src={service.thumb} alt="" loading="lazy" decoding="async" />
				<div class="lp-service__tag">
					<Tag value={service.category} variant="subtle" rounded />
				</div>
			</div>
			<div class="lp-service__body">
				<h3 class="lp-service__title">{service.title}</h3>
				<span class="lp-service__provider">{service.provider}</span>
				<div class="lp-service__foot">
					<span class="lp-service__price">{service.price}</span>
					<span class="lp-service__delivery">{service.delivery}</span>
				</div>
			</div>
		</a>
	);
}
