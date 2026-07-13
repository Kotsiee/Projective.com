import { ServiceCard } from "../components/ServiceCard.tsx";
import type { ServiceShowcase } from "../core/landing-data.ts";
import { useCarousel } from "../core/useCarousel.ts";

/**
 * ServicesCarousel — a horizontal drag-swipeable track of fixed-price service offerings (SERVICES
 * CAROUSEL). Dumb island: receives a serialisable array and owns only the scroll interaction; each
 * card is a library-composed anchor routing straight to its service detail.
 */
export default function ServicesCarousel({ services }: { services: ServiceShowcase[] }) {
	const { trackRef, prev, next, atStart, atEnd } = useCarousel();

	return (
		<div class="lp-carousel">
			<div class="lp-carousel__viewport">
				<div class="lp-carousel__track lp-carousel__track--services" ref={trackRef} role="list">
					{services.map((s) => (
						<div class="lp-carousel__cell" role="listitem" key={s.slug}>
							<ServiceCard service={s} />
						</div>
					))}
				</div>
				<div class="lp-carousel__edge lp-carousel__edge--start" aria-hidden="true" />
				<div class="lp-carousel__edge lp-carousel__edge--end" aria-hidden="true" />
			</div>
			<div class="lp-carousel__nav">
				<button
					type="button"
					class="lp-carousel__btn"
					aria-label="Previous services"
					disabled={atStart.value}
					onClick={prev}
				>
					←
				</button>
				<button
					type="button"
					class="lp-carousel__btn"
					aria-label="Next services"
					disabled={atEnd.value}
					onClick={next}
				>
					→
				</button>
			</div>
		</div>
	);
}
