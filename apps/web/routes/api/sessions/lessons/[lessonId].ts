import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LessonProgressInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/sessions/lessons/[lessonId]` `{ done }` — tick or un-tick a curriculum lesson for the
 * viewer. `projects.complete_lesson` holds the writer to a seat on a cohort that follows the lesson.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const lessonId = ctx.params.lessonId;
		if (!UUID_RE.test(lessonId)) {
			return Response.json({ ok: false, message: "Unknown lesson." }, { status: 404 });
		}
		const parsed = LessonProgressInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Send { done: boolean }." }, { status: 422 });
		}
		return toProjectsResponse(
			await SessionBackendService.completeLesson(lessonId, parsed.data.done, readActor(ctx)),
		);
	},
});
