import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidFields } from "@web/utils/service-response.ts";
import { FeedbackIdeaSlugSchema, FeedbackModerationSchema } from "@projective/types/community";
import { FeedbackBackendService } from "@server/services/community/FeedbackBackendService.ts";
import { feedbackNotFound, feedbackResponse } from "@features/feedback/core/feedback-respond.ts";

/**
 * `POST /api/feedback/ideas/:id/status` — a platform operator's door (Decision #272): `{ status?,
 * note?, response? }` moves the idea along the lifecycle (PRODUCT_MANAGEMENT.md §3.9) and/or writes
 * the team's response. The database decides who is an operator (`security.is_admin()`); everyone else
 * gets 403, an illegal move 409. A move notifies the author and every voter.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const slug = FeedbackIdeaSlugSchema.safeParse(ctx.params.id);
		if (!slug.success) return feedbackNotFound();
		const parsed = FeedbackModerationSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return feedbackResponse(
			await FeedbackBackendService.moderate(slug.data, parsed.data, readActor(ctx)),
		);
	},
});
