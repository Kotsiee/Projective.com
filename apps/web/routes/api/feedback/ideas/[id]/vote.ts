import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { FeedbackIdeaSlugSchema } from "@projective/types/community";
import { FeedbackBackendService } from "@server/services/community/FeedbackBackendService.ts";
import { feedbackNotFound, feedbackResponse } from "@features/feedback/core/feedback-respond.ts";

/**
 * `/api/feedback/ideas/:id/vote` — idempotent both ways (Decision #272): `POST` votes, `DELETE`
 * retracts, and a repeat of either answers the same `{ voted, voteCount }`. 401 for a guest, 404 for
 * an idea the reader may not see, 409 once voting has closed (shipped or archived), 429 past the
 * hourly limit.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const slug = FeedbackIdeaSlugSchema.safeParse(ctx.params.id);
		if (!slug.success) return feedbackNotFound();
		return feedbackResponse(await FeedbackBackendService.vote(slug.data, true, readActor(ctx)));
	},

	async DELETE(ctx) {
		const slug = FeedbackIdeaSlugSchema.safeParse(ctx.params.id);
		if (!slug.success) return feedbackNotFound();
		return feedbackResponse(await FeedbackBackendService.vote(slug.data, false, readActor(ctx)));
	},
});
