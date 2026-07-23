import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { profileHref } from "@features/explore/core/routing.ts";
import { Empty, formatDate } from "./tab-shared.tsx";
import type { ProfileTabPayload, ReviewEntry } from "../../types/profile-types.ts";

/**
 * ReviewsTab — the dual-track reputation body (root CLAUDE.md Part 2): the as-a-freelancer / as-a-client
 * summary meters over the reciprocal review list (reviewer · role · rating · date · context).
 */
export function ReviewsTab(
	{ reviews, summary }: { reviews: ReviewEntry[]; summary?: ProfileTabPayload["reviewSummary"] },
): JSX.Element {
	return (
		<div class="pf-reviews">
			{summary && (summary.asHelper || summary.asClient)
				? (
					<div class="pf-reviews__summary">
						{summary.asHelper && (
							<div class="pf-rep__track">
								<span class="pf-rep__role">As a freelancer</span>
								<RatingStars
									value={summary.asHelper.value}
									count={summary.asHelper.count}
									size="md"
								/>
							</div>
						)}
						{summary.asClient && (
							<div class="pf-rep__track">
								<span class="pf-rep__role">As a client</span>
								<RatingStars
									value={summary.asClient.value}
									count={summary.asClient.count}
									size="md"
								/>
							</div>
						)}
					</div>
				)
				: null}
			{reviews.length
				? (
					<ul class="pf-review-list" role="list">
						{reviews.map((r) => (
							<li class="pf-review" key={r.id}>
								<Avatar image={r.authorAvatar} label={r.authorName} size="md" shape="circle" />
								<div class="pf-review__body">
									<div class="pf-review__head">
										<a class="pf-review__author" href={profileHref(r.authorHandle)}>
											{r.authorName}
										</a>
										<span class="pf-review__role" data-role={r.role}>
											{r.role === "client" ? "As a client" : "As a freelancer"}
										</span>
									</div>
									<div class="pf-review__meta">
										<RatingStars value={r.rating} size="sm" label={`Rated ${r.rating} out of 5`} />
										<time class="pf-review__date">{formatDate(r.date)}</time>
									</div>
									<p class="pf-review__text">{r.body}</p>
									{r.contextTitle
										? <span class="pf-review__context">on {r.contextTitle}</span>
										: null}
								</div>
							</li>
						))}
					</ul>
				)
				: <Empty note="No reviews yet." />}
		</div>
	);
}
