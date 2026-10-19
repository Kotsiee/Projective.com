import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidFields } from "@web/utils/service-response.ts";
import { FeedbackBoardQuerySchema, FeedbackIdeaCreateSchema } from "@projective/types/community";
import { FeedbackBackendService } from "@server/services/community/FeedbackBackendService.ts";
import { feedbackResponse } from "@features/feedback/core/feedback-respond.ts";

/**
 * `/api/feedback/ideas` — thin routes over {@link FeedbackBackendService} (Decision #272). The reader
 * comes from the session; a guest reads the public board.
 *
 * - `GET ?status=&sort=&q=&limit=` — the board as the reader may see it, with every tab's count.
 *   `q` is the composer's title search.
 * - `POST { title, category, impact, body? }` — suggest an idea (signed in). It enters Under review;
 *   201 with the idea, 422 field errors, 429 with `Retry-After`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const q = ctx.url.searchParams;
		const parsed = FeedbackBoardQuerySchema.safeParse({
			status: q.get("status") ?? undefined,
			sort: q.get("sort") ?? undefined,
			q: q.get("q") ?? undefined,
			limit: q.get("limit") ?? undefined,
		});
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return feedbackResponse(await FeedbackBackendService.board(parsed.data, readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = FeedbackIdeaCreateSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return feedbackResponse(await FeedbackBackendService.submit(parsed.data, readActor(ctx)));
	},
});
