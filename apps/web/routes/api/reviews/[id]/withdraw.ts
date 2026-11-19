import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	noReview,
	reviewIdOf,
	signedOut,
	toReviewsResponse,
} from "@features/reviews/core/respond.ts";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";

/**
 * `POST /api/reviews/:id/withdraw` — the author withdraws their review (Decision #487): kept, gone
 * from every reader and average; a second call is the same success. 403 for anyone but its author.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = reviewIdOf(ctx.params.id);
		if (!id) return noReview();
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		return toReviewsResponse(await ReviewsBackendService.withdraw(id, actor));
	},
});
