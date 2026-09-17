import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Avatar, RatingStars } from "@projective/ui/display";
import { SelectButton } from "@projective/ui/fields";
import type { Option } from "@projective/ui/fields";
import { profileHref } from "@features/explore/core/routing.ts";
import "../styles/profile.css";
import {
	parseReviewStance,
	reviewsForStance,
	type ReviewStance,
	reviewStanceCounts,
} from "../core/profile-model.ts";
import { formatDate } from "../components/tabs/tab-shared.tsx";
import type { ReviewEntry } from "../types/profile-types.ts";

/**
 * ReviewsList — the Reviews section's rows behind a segmented stance filter: **All · As freelancer
 * · As client**. The filter narrows the list in place (no navigation, no refetch — the section
 * already holds every review) and mirrors its choice into `?as=` with `replaceState`, so a filtered
 * view is shareable and survives a reload without adding history entries.
 *
 * The stance rule itself lives in `profile-model.ts` (`reviewsForStance`) — a review's stored `role`
 * is the AUTHOR's side, and the profile's stance is its inverse; that inversion is written once and
 * unit-tested there rather than here. The segments carry the stance alone — no counts on the
 * control — while the status line beneath speaks how many are shown and the empty note states a
 * stance with nothing in it; each row names the AUTHOR's side of the engagement ("as their
 * client") so a row under "As freelancer" reads as a client's review of a freelancer.
 *
 * An island because the filter is interactive; the summary tracks above it stay a server component.
 */
export interface ReviewsListProps {
	reviews: ReviewEntry[];
	/** The stance the URL asked for on first paint (`?as=`), so SSR renders the filtered list. */
	initialStance?: ReviewStance;
}

const STANCE_LABEL: Record<ReviewStance, string> = {
	all: "All",
	freelancer: "As freelancer",
	client: "As client",
};

const EMPTY_NOTE: Record<Exclude<ReviewStance, "all">, string> = {
	freelancer: "No reviews received as a freelancer yet.",
	client: "No reviews received as a client yet.",
};

// #region Row
function Review({ review }: { review: ReviewEntry }): JSX.Element {
	const role = review.role === "client" ? "as their client" : "as their freelancer";
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

export default function ReviewsList(
	{ reviews, initialStance = "all" }: ReviewsListProps,
): JSX.Element {
	// The segmented control OWNS this signal (signal-first, one state); the stance is read off it.
	const selection = useSignal<string | string[]>(initialStance);
	const stance = useComputed(() =>
		parseReviewStance(typeof selection.value === "string" ? selection.value : null)
	);
	const counts = reviewStanceCounts(reviews);
	const visible = useComputed(() => reviewsForStance(reviews, stance.value));

	// The address bar is the one source a shared link reads from; keep it in step without a history
	// entry per click.
	useEffect(() => {
		try {
			const url = new URL(globalThis.location.href);
			if (stance.value === "all") url.searchParams.delete("as");
			else url.searchParams.set("as", stance.value);
			globalThis.history.replaceState(globalThis.history.state, "", url);
		} catch { /* SSR / no window — non-fatal */ }
	}, [stance.value]);

	// The segments carry the stance only; the counts are spoken by the status line beneath and
	// stated by the empty note, never printed on the control.
	const options: Option[] = (["all", "freelancer", "client"] as const).map((value) => ({
		value,
		label: STANCE_LABEL[value],
	}));

	const current = stance.value;
	return (
		<div class="pf-reviews__filtered">
			<div class="pf-reviews__filter">
				<SelectButton
					options={options}
					value={selection}
					size="sm"
					aria-label="Filter reviews by the role this profile held"
				/>
			</div>
			<p class="ui-visually-hidden" role="status">
				{current === "all"
					? `Showing all ${counts.all} reviews`
					: `Showing ${visible.value.length} of ${counts.all} reviews, ${
						STANCE_LABEL[current].toLowerCase()
					}`}
			</p>
			{visible.value.length > 0
				? (
					<ul class="pf-reviews__list" role="list">
						{visible.value.map((review) => <Review key={review.id} review={review} />)}
					</ul>
				)
				: (
					<p class="pf-empty__note" role="status">
						{current === "all" ? "No reviews yet." : EMPTY_NOTE[current]}
					</p>
				)}
		</div>
	);
}
