import { ProfileCard } from "../components/ProfileCard.tsx";
import type { ProfileShowcase } from "../core/landing-data.ts";
import { useCarousel } from "../core/useCarousel.ts";

/**
 * ProfilesCarousel — a smooth, drag-swipeable horizontal track of mixed freelancer & team cards
 * (PROFILES CAROUSEL). Dumb island: it receives a serialisable array and owns only the scroll
 * interaction — the cards are library-composed anchors, each a direct route to its `[handle]`.
 */
export default function ProfilesCarousel({ profiles }: { profiles: ProfileShowcase[] }) {
	const { trackRef, prev, next, atStart, atEnd } = useCarousel();

	return (
		<div class="lp-carousel">
			<div class="lp-carousel__viewport">
				<div class="lp-carousel__track lp-carousel__track--profiles" ref={trackRef} role="list">
					{profiles.map((p) => (
						<div class="lp-carousel__cell" role="listitem" key={p.handle}>
							<ProfileCard profile={p} />
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
					aria-label="Previous profiles"
					disabled={atStart.value}
					onClick={prev}
				>
					←
				</button>
				<button
					type="button"
					class="lp-carousel__btn"
					aria-label="Next profiles"
					disabled={atEnd.value}
					onClick={next}
				>
					→
				</button>
			</div>
		</div>
	);
}
