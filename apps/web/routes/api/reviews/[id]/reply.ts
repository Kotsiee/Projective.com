import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	invalid,
	noReview,
	readJsonBody,
	reviewIdOf,
	signedOut,
	toReviewsResponse,
} from "@features/reviews/core/respond.ts";
import { ReviewReplyInputSchema } from "@projective/types/reviews";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";

/**
 * `/api/reviews/:id/reply` — the reviewed side's one public reply (Decision #487,
 * {@link ReviewReplyInputSchema}, 1–1,000 characters). `POST` posts it (409 if one exists); `PATCH`
 * rewrites it for 7 days after it was posted (410 after). 403 for anyone who does not answer for the
 * review's target.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = reviewIdOf(ctx.params.id);
		if (!id) return noReview();
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = ReviewReplyInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toReviewsResponse(await ReviewsBackendService.reply(id, parsed.data, actor));
	},

	async PATCH(ctx) {
		const id = reviewIdOf(ctx.params.id);
		if (!id) return noReview();
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = ReviewReplyInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toReviewsResponse(await ReviewsBackendService.editReply(id, parsed.data, actor));
	},
});
