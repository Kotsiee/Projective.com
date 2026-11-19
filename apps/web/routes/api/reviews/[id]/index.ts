import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import {
	invalid,
	noReview,
	readJsonBody,
	reviewIdOf,
	signedOut,
	toReviewsResponse,
} from "@features/reviews/core/respond.ts";
import { EditReviewInputSchema } from "@projective/types/reviews";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";

/**
 * `PATCH /api/reviews/:id` — the author rewrites their review ({@link EditReviewInputSchema}) while
 * its window is open and before the target replies (Decision #487): 403 for anyone but its author,
 * 409 once it has a reply, 410 once the window closed.
 */
export const handler = define.handlers({
	async PATCH(ctx) {
		const id = reviewIdOf(ctx.params.id);
		if (!id) return noReview();
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = EditReviewInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toReviewsResponse(await ReviewsBackendService.edit(id, parsed.data, actor));
	},
});
