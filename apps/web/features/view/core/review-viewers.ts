import type { EntityView } from "@projective/types/explore";
import type { ReadActor } from "@server/services/read-actor.ts";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";

/**
 * The viewer's actions on a `/view` page's reviews (Decision #487): Edit on the review they wrote,
 * Reply or Edit reply on a review of what they answer for. The page itself is read anonymously and
 * shared by every visitor, so who may do what is joined on here, per request, and never cached with it.
 * A guest, or a page with no reviews, comes back unchanged.
 */
export async function withReviewViewers(
	view: EntityView | undefined,
	actor: ReadActor,
): Promise<EntityView | undefined> {
	if (!view || !actor.userId || !view.reviews.list.length) return view;
	const result = await ReviewsBackendService.viewerActions(view.reviews.list.map((r) => r.id), actor);
	const viewers = result.ok && result.data ? result.data : {};
	if (!Object.keys(viewers).length) return view;
	return {
		...view,
		reviews: {
			...view.reviews,
			list: view.reviews.list.map((r) => (viewers[r.id] ? { ...r, viewer: viewers[r.id] } : r)),
		},
	};
}
