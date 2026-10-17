import type { JSX } from "preact";
import { Badge, RatingStars } from "@projective/ui/display";
import ReviewsList from "../../islands/ReviewsList.island.tsx";
import {
	type ReviewStance,
	reviewSummaryFor,
	type ReviewSummaryTrack,
} from "../../core/profile-model.ts";
import type { ProfileKind, ProfileTabPayload } from "../../types/profile-types.ts";

/**
 * ReviewsTab — the Reviews section: the summary as one inline, unboxed line, then the reviews behind
 * the {@link ReviewsList} island. What the summary holds is `reviewSummaryFor`'s decision per kind:
 *
 *  - a PERSON is reviewed on two tracks (as a freelancer · as a client) and the list carries the
 *    segmented stance filter;
 *  - a BUSINESS is only ever the client, so its list has no filter (Decision #244);
 *  - a TEAM's reviews are its COLLECTIVE ones — reviews whose subject is the team, never a member's
 *    own, which stay on that member's page (Teams P1) — summarised as one aggregate RatingStars with
 *    the review count as a count Badge beside it (§B.11: a count is one of the four things a
 *    container may hold), and no filter: a team is only ever the provider.
 *
 * The summary is a SERVER component (`RatingStars` and `Badge` are zero-JS); the stars are forced
 * monochrome in `profile-reviews.css`.
 */
export interface ReviewsTabProps {
	payload: ProfileTabPayload;
	/** The stance the URL asked for (`?as=`), so the first paint is already filtered. */
	stance?: ReviewStance;
	/** The profile's kind — which summary it draws and whether the stance filter applies. */
	kind: ProfileKind;
}

// #region Summary
function SummaryTrack(
	{ entry, countBadge }: { entry: ReviewSummaryTrack; countBadge: boolean },
): JSX.Element {
	const { label, track } = entry;
	const score = track.value.toFixed(1);
	const reviews = `${track.count} ${track.count === 1 ? "review" : "reviews"}`;
	return (
		<div class="pf-reviews__track">
			<span class="pf-reviews__role">{label}</span>
			{countBadge
				? (
					<>
						<RatingStars
							value={track.value}
							showValue
							size="md"
							label={`${label}: ${score} out of 5 from ${reviews}`}
						/>
						<Badge
							value={track.count}
							severity="secondary"
							size="sm"
							class="pf-reviews__count"
						/>
					</>
				)
				: (
					<RatingStars
						value={track.value}
						count={track.count}
						size="md"
						label={`Rated ${score} out of 5 ${label.toLowerCase()}, ${track.count} ratings`}
					/>
				)}
		</div>
	);
}
// #endregion

export function ReviewsTab({ payload, stance = "all", kind }: ReviewsTabProps): JSX.Element {
	const summary = reviewSummaryFor(kind, payload.reviewSummary);
	return (
		<div class="pf-reviews">
			{summary.tracks.length > 0
				? (
					<div class="pf-reviews__summary">
						{summary.tracks.map((entry) => (
							<SummaryTrack key={entry.label} entry={entry} countBadge={summary.countBadge} />
						))}
					</div>
				)
				: null}
			<ReviewsList
				reviews={payload.reviews}
				initialStance={summary.stances ? stance : "all"}
				stances={summary.stances}
			/>
		</div>
	);
}
