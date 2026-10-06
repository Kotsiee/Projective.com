import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { MarkViewSeenInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectNavActivityService } from "@server/services/projects/ProjectNavActivityService.ts";

/**
 * `POST /api/projects/nav-seen` — thin route: Zod-validate `{ projectId, view }` and delegate to the
 * fat {@link ProjectNavActivityService.markSeen}, which records that the viewer opened one of the
 * engagement's lane views so its activity mark clears. The project lane posts it once per arrival.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to keep track of what you have seen." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = MarkViewSeenInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That view could not be recorded." },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectNavActivityService.markSeen(parsed.data, actor));
	},
});
