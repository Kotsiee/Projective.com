import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ReopenProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/:id/reopen` — `{ reason? }` → `projects.reopen_project`: the client reopens a
 * completed engagement to extend it, `completed → active`, recorded in the status history (EX1,
 * Decision #546). Anything but a completed engagement answers 409. Thin route; the function checks
 * review authority itself (Decision #53(b)).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to reopen a project." }, { status: 401 });
		}
		const raw = await ctx.req.json().catch(() => null) as { reason?: unknown } | null;
		const parsed = ReopenProjectSchema.safeParse({
			projectId: ctx.params.id,
			reason: typeof raw?.reason === "string" && raw.reason.trim() ? raw.reason : undefined,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That request is not valid." },
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.reopenProject(parsed.data, actor));
	},
});
