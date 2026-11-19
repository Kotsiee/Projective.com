import type { JSX } from "preact";
import { type Reviewable, type ReviewState, reviewStateOf } from "@projective/types/reviews";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { Block, MetaFacts } from "../dashboard/DashboardBlocks.tsx";

/**
 * ReviewsBlock — the Overview's Reviews region (Decision #487): one row per provider the viewer may
 * review on this engagement, or per session seat, each a link to the review dialog
 * (`?review=<slug>`, ROUTING.md), its state said in inline Meta text. Renders nothing while there is
 * nothing to review — the database decides when there is (`reviews.get_reviewables`), and before an
 * engagement completes there is not.
 */
export interface ReviewsBlockProps {
	slug: string;
	items: Reviewable[];
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The row's state, as one Meta line. */
function stateFacts(item: Reviewable, state: ReviewState): string[] {
	const closes = DATE.format(new Date(item.closes_at));
	switch (state) {
		case "open":
			return ["Not reviewed yet", `Open until ${closes}`];
		case "reviewed":
			return [
				"Reviewed",
				`Editable until ${DATE.format(new Date(item.review?.window_closes_at ?? item.closes_at))}`,
			];
		case "locked":
			return item.review?.reply ? ["Reviewed", "Replied"] : ["Reviewed"];
		case "withdrawn":
			return ["Review withdrawn"];
		case "closed":
			return [`Review window closed ${closes}`];
	}
}

export function ReviewsBlock({ slug, items }: ReviewsBlockProps): JSX.Element | null {
	if (!items.length) return null;
	const href = `?review=${encodeURIComponent(slug)}`;
	return (
		<Block title="Reviews" region="reviews">
			<ul class="pjd-list pjd-people">
				{items.map((item) => {
					const name = item.target?.name ?? "Provider";
					const state = reviewStateOf(item);
					return (
						<li key={`${item.anchor_id}:${item.target_id}`}>
							<a
								class="pjd-row"
								href={href}
								aria-label={state === "open" ? `Review ${name}` : `Your review of ${name}`}
							>
								<UserAvatar image={item.target?.avatar ?? undefined} label={name} size="sm" />
								<span class="pjd-row__body">
									<span class="pjd-row__title">{name}</span>
									<MetaFacts items={stateFacts(item, state)} />
								</span>
							</a>
						</li>
					);
				})}
			</ul>
		</Block>
	);
}
