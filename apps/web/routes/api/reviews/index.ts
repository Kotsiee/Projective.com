import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import {
	invalid,
	readJsonBody,
	signedOut,
	toReviewsResponse,
} from "@features/reviews/core/respond.ts";
import { SubmitReviewInputSchema } from "@projective/types/reviews";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";

/**
 * `POST /api/reviews` — thin route over writing a review (Decision #487): the signed-in person's
 * review of a target on an anchor they completed ({@link SubmitReviewInputSchema}). The database
 * decides eligibility, the window and the one-per-party rule; this answers 201 with the review's id,
 * 403 for a 13–17 account or someone who is not the anchor's party, 404 when nothing on the anchor is
 * complete for that target, 409 for a second review, 410 once the window closed, 422 for a review of
 * oneself or a body the schema refuses, 501 for a product until CK1.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = SubmitReviewInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toReviewsResponse(await ReviewsBackendService.submit(parsed.data, actor));
	},
});
