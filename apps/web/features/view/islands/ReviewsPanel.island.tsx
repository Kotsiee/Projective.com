import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar, RatingStars } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { VerifiedBadge } from "@features/explore/components/VerifiedBadge.tsx";
import { profileHref } from "@features/explore/core/routing.ts";
import type { EntityReview, ReviewSummary } from "@projective/types/explore";

/**
 * ReviewsPanel — the full reviews section (Part 3.3). The left aggregate column shows the average, a
 * five-star meter, and the 5★→1★ distribution chart (each bar clickable to filter the list to that
 * rating); the right column is the sortable/filterable review list (recent · highest · lowest), each
 * entry carrying the reciprocal-review + verified-engagement trust badges. Interactive, so it's an
 * island; it also anchors `Avatar`/`RatingStars` CSS onto the page (the reused cards are server
 * components — the glass-blur CSS-bundling rule).
 */

type SortKey = "recent" | "highest" | "lowest";

export interface ReviewsPanelProps {
	summary: ReviewSummary;
	list: EntityReview[];
}

export default function ReviewsPanel({ summary, list }: ReviewsPanelProps): JSX.Element {
	const sort = useSignal<SortKey>("recent");
	const starFilter = useSignal<number | null>(null);

	const total = summary.count || summary.distribution.reduce((a, b) => a + b, 0);

	let shown = starFilter.value
		? list.filter((r) => Math.round(r.rating) === starFilter.value)
		: [...list];
	shown = shown.sort((a, b) => {
		if (sort.value === "highest") {
			return b.rating - a.rating || b.createdAt.localeCompare(a.createdAt);
		}
		if (sort.value === "lowest") {
			return a.rating - b.rating || b.createdAt.localeCompare(a.createdAt);
		}
		return b.createdAt.localeCompare(a.createdAt);
	});

	return (
		<section id="view-reviews" class="vw-reviews" aria-label="Reviews">
			<h2 class="vw-reviews__title">Reviews</h2>
			<div class="vw-reviews__grid">
				{/* Aggregate breakdown. */}
				<aside class="vw-revagg">
					<div class="vw-revagg__score">
						<span class="vw-revagg__avg">{summary.average.toFixed(1)}</span>
						<RatingStars value={summary.average} size="md" />
						<span class="vw-revagg__count">{total.toLocaleString("en-US")} reviews</span>
					</div>

					{(summary.asHelper || summary.asClient) && (
						<div class="vw-revagg__tracks">
							{summary.asHelper && (
								<div class="vw-revagg__track">
									<span class="vw-revagg__tracklabel">As helper</span>
									<RatingStars
										value={summary.asHelper.value}
										count={summary.asHelper.count}
										size="sm"
									/>
								</div>
							)}
							{summary.asClient && (
								<div class="vw-revagg__track">
									<span class="vw-revagg__tracklabel">As client</span>
									<RatingStars
										value={summary.asClient.value}
										count={summary.asClient.count}
										size="sm"
									/>
								</div>
							)}
						</div>
					)}

					<div class="vw-revbars" role="group" aria-label="Rating distribution">
						{[5, 4, 3, 2, 1].map((star) => {
							const count = summary.distribution[star - 1] ?? 0;
							const pct = total > 0 ? Math.round((count / total) * 100) : 0;
							const on = starFilter.value === star;
							return (
								<button
									key={star}
									type="button"
									class="vw-revbar"
									data-on={on ? "true" : undefined}
									aria-pressed={on}
									aria-label={`${star} star, ${count} reviews${on ? " (filter active)" : ""}`}
									onClick={() => (starFilter.value = on ? null : star)}
								>
									<span class="vw-revbar__star">
										{star}
										<Icon name="star" filled />
									</span>
									<span class="vw-revbar__track">
										<span class="vw-revbar__fill" style={`inline-size:${pct}%`} />
									</span>
									<span class="vw-revbar__pct">{pct}%</span>
								</button>
							);
						})}
					</div>
				</aside>

				{/* Filterable list. */}
				<div class="vw-revlist">
					<div class="vw-revlist__toolbar">
						<div class="vw-revlist__count">
							{starFilter.value
								? (
									<button
										type="button"
										class="vw-revlist__clear"
										onClick={() => (starFilter.value = null)}
									>
										{shown.length} · {starFilter.value}
										<Icon name="star" filled /> — clear filter
									</button>
								)
								: <span>{shown.length} reviews</span>}
						</div>
						<div class="vw-sort" role="group" aria-label="Sort reviews">
							{(["recent", "highest", "lowest"] as SortKey[]).map((k) => (
								<button
									key={k}
									type="button"
									class="vw-sort__opt"
									data-active={sort.value === k ? "true" : undefined}
									aria-pressed={sort.value === k}
									onClick={() => (sort.value = k)}
								>
									{SORT_LABEL[k]}
								</button>
							))}
						</div>
					</div>

					{shown.length === 0
						? <p class="vw-revlist__empty">No reviews match this filter.</p>
						: (
							<ul class="vw-revlist__items" role="list">
								{shown.map((r) => <ReviewCard key={r.id} review={r} />)}
							</ul>
						)}
				</div>
			</div>
		</section>
	);
}

const SORT_LABEL: Record<SortKey, string> = {
	recent: "Most recent",
	highest: "Highest",
	lowest: "Lowest",
};

function ReviewCard({ review }: { review: EntityReview }): JSX.Element {
	const a = review.author;
	return (
		<li class="vw-review">
			<div class="vw-review__head">
				<a
					class="vw-review__author"
					href={profileHref(a.handle)}
					aria-label={`${a.name} — view profile`}
				>
					<Avatar
						image={a.avatar}
						alt=""
						size="sm"
						shape={a.kind === "business" ? "square" : "circle"}
					/>
					<span class="vw-review__id">
						<span class="vw-review__name">
							{a.name}
							{a.verified ? <VerifiedBadge size="sm" /> : null}
						</span>
						<span class="vw-review__handle">{a.handle}</span>
					</span>
				</a>
				<span class="vw-review__meta">
					<RatingStars value={review.rating} size="sm" />
					<span class="vw-review__date">{review.dateLabel}</span>
				</span>
			</div>
			<div class="vw-review__body">
				<h3 class="vw-review__reviewtitle">{review.title}</h3>
				<p class="vw-review__text">{review.body}</p>
			</div>
			<div class="vw-review__badges">
				{review.verifiedEngagement
					? (
						<span class="vw-review__badge" data-kind="verified">
							<Icon name="check" /> Verified engagement
						</span>
					)
					: null}
				{review.reciprocal
					? (
						<span class="vw-review__badge" data-kind="reciprocal">
							<Icon name="switch" /> Reciprocal review
						</span>
					)
					: null}
				<span class="vw-review__badge" data-kind="track">
					{review.track === "helper" ? "Rated as helper" : "Rated as client"}
				</span>
			</div>
		</li>
	);
}
