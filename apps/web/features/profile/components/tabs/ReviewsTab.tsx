import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { profileHref } from "@features/explore/core/routing.ts";
import { formatDate } from "./tab-shared.tsx";
import type { ProfileTabPayload, RatingTrack, ReviewEntry } from "../../types/profile-types.ts";

/**
 * ReviewsTab — the Reviews section: the dual-track summary (as a freelancer · as a client) as one
 * inline, unboxed line, then the reciprocal reviews as hairline-separated rows. A SERVER component
 * (`RatingStars` is zero-JS); the stars are forced monochrome in `profile-reviews.css`.
 */
export interface ReviewsTabProps {
	payload: ProfileTabPayload;
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

// #region Row
function Review({ review }: { review: ReviewEntry }): JSX.Element {
	const role = review.role === "client" ? "as a client" : "as a freelancer";
	return (
		<li class="pf-review">
			<Avatar
				image={review.authorAvatar}
				label={review.authorName}
				size={40}
				shape="circle"
				class="pf-review__avatar"
			/>
			<div class="pf-review__body">
				<div class="pf-review__head">
					<a class="pf-review__author" href={profileHref(review.authorHandle)}>
						{review.authorName}
					</a>
					<span class="pf-review__sep" aria-hidden="true">·</span>
					<span class="pf-review__role">{role}</span>
				</div>
				<div class="pf-review__meta">
					<RatingStars
						value={review.rating}
						size="sm"
						label={`Rated ${review.rating} out of 5`}
					/>
					<time class="pf-review__date" dateTime={review.date}>{formatDate(review.date)}</time>
				</div>
				<p class="pf-review__text">{review.body}</p>
				{review.contextTitle
					? <span class="pf-review__context">on {review.contextTitle}</span>
					: null}
			</div>
		</li>
	);
}
// #endregion

export function ReviewsTab({ payload }: ReviewsTabProps): JSX.Element {
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
			<ul class="pf-reviews__list" role="list">
				{payload.reviews.map((review) => <Review key={review.id} review={review} />)}
			</ul>
		</div>
	);
}
