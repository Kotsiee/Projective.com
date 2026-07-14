import { useCarousel } from "@features/marketing/core/useCarousel.ts";
import { FreelancerCard } from "../components/cards/FreelancerCard.tsx";
import { ProfileBannerCard } from "../components/cards/ProfileBannerCard.tsx";
import type { ProfileItem } from "../types/explore-types.ts";

/**
 * EntityCarousel — a smooth, drag- and touch-swipeable horizontal track for the Home layout's profile
 * entities. Dumb island: it receives a serialisable array + a `kind` and owns only the scroll
 * interaction (reusing marketing's `useCarousel`: pointer drag + native touch momentum + edge
 * signals). Cards are library-composed anchors, so from Home they navigate natively (no `onSelect`).
 * `freelancers` render compact cards (no banner); `profiles` (users/teams/businesses) render wide
 * banner cards.
 */
export default function EntityCarousel(
	{ kind, items, label, authed = false }: {
		kind: "freelancers" | "profiles";
		items: ProfileItem[];
		label: string;
		authed?: boolean;
	},
) {
	const { trackRef, prev, next, atStart, atEnd } = useCarousel();

	return (
		<div class="ex-carousel">
			<div class="ex-carousel__viewport">
				<div
					class={`ex-carousel__track ex-carousel__track--${kind}`}
					ref={trackRef}
					role="list"
					aria-label={label}
				>
					{items.map((it) => (
						<div class="ex-carousel__cell" role="listitem" key={it.id}>
							{kind === "freelancers"
								? <FreelancerCard item={it} authed={authed} />
								: <ProfileBannerCard item={it} authed={authed} />}
						</div>
					))}
				</div>
				<div class="ex-carousel__edge ex-carousel__edge--start" aria-hidden="true" />
				<div class="ex-carousel__edge ex-carousel__edge--end" aria-hidden="true" />
			</div>
			<div class="ex-carousel__nav">
				<button
					type="button"
					class="ex-carousel__btn"
					aria-label={`Previous ${label}`}
					disabled={atStart.value}
					onClick={prev}
				>
					←
				</button>
				<button
					type="button"
					class="ex-carousel__btn"
					aria-label={`Next ${label}`}
					disabled={atEnd.value}
					onClick={next}
				>
					→
				</button>
			</div>
		</div>
	);
}
