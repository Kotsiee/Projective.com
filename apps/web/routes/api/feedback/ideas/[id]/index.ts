import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { FeedbackIdeaSlugSchema } from "@projective/types/community";
import { FeedbackBackendService } from "@server/services/community/FeedbackBackendService.ts";
import { feedbackNotFound, feedbackResponse } from "@features/feedback/core/feedback-respond.ts";

/**
 * `GET /api/feedback/ideas/:id` — one idea (by its `fbk-` slug), its status history and up to three
 * related ideas (Decision #272). 404 for anything that is not an idea's address, and for an idea the
 * reader may not see — an idea under review is never confirmed to exist.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const slug = FeedbackIdeaSlugSchema.safeParse(ctx.params.id);
		if (!slug.success) return feedbackNotFound();
		return feedbackResponse(await FeedbackBackendService.idea(slug.data, readActor(ctx)));
	},
});
