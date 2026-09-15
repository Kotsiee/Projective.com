import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import ReviewsList from "../../islands/ReviewsList.island.tsx";
import type { ReviewStance } from "../../core/profile-model.ts";
import type { ProfileTabPayload, RatingTrack } from "../../types/profile-types.ts";

/**
 * ReviewsTab — the Reviews section: the dual-track summary (as a freelancer · as a client) as one
 * inline, unboxed line, then the reciprocal reviews behind the {@link ReviewsList} island's
 * segmented stance filter. The summary is a SERVER component (`RatingStars` is zero-JS); the stars
 * are forced monochrome in `profile-reviews.css`.
 */
export interface ReviewsTabProps {
	payload: ProfileTabPayload;
	/** The stance the URL asked for (`?as=`), so the first paint is already filtered. */
	stance?: ReviewStance;
}

// #region Summary
function SummaryTrack({ role, track }: { role: string; track: RatingTrack }): JSX.Element {
	const score = track.value.toFixed(1);
	const label = `Rated ${score} out of 5 ${role.toLowerCase()}, ${track.count} ratings`;
	return (
		<div class="pf-reviews__track">
			<span class="pf-reviews__role">{role}</span>
			<RatingStars value={track.value} count={track.count} size="md" label={label} />
		</div>
	);
}
// #endregion

export function ReviewsTab({ payload, stance = "all" }: ReviewsTabProps): JSX.Element {
	const summary = payload.reviewSummary;
	const asHelper = summary?.asHelper;
	const asClient = summary?.asClient;
	return (
		<div class="pf-reviews">
			{asHelper || asClient
				? (
					<div class="pf-reviews__summary">
						{asHelper ? <SummaryTrack role="As a freelancer" track={asHelper} /> : null}
						{asClient ? <SummaryTrack role="As a client" track={asClient} /> : null}
					</div>
				)
				: null}
			<ReviewsList reviews={payload.reviews} initialStance={stance} />
		</div>
	);
}
