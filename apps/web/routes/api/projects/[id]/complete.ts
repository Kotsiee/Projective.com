import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CompleteProjectSchema, PreviewProjectCompleteSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `/api/projects/:id/complete` — the client completes an engagement (EX1, Decision #546). Thin route:
 * validate the address and body, then delegate to the fat {@link ProjectBackendService}.
 *
 * - `GET` — what completing closes (`projects.preview_project_complete`): the open, unfunded tickets
 *   and open stages, or why it cannot complete now.
 * - `POST` — `{ reason? }` → `projects.complete_project`. Money still held or reserved answers 409
 *   `settle_first`, an open dispute 409 `dispute_open`.
 *
 * **No capability guard** — both functions check review authority themselves (Decision #53(b)); the
 * 401 below only establishes who is asking.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to complete a project." }, {
				status: 401,
			});
		}
		const parsed = PreviewProjectCompleteSchema.safeParse({ projectId: ctx.params.id });
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That project address is not valid." },
				{ status: 422 },
			);
		}
		return toProjectsResponse(
			await ProjectBackendService.previewProjectComplete(parsed.data, actor),
		);
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to complete a project." }, {
				status: 401,
			});
		}
		const raw = await ctx.req.json().catch(() => null) as { reason?: unknown } | null;
		const parsed = CompleteProjectSchema.safeParse({
			projectId: ctx.params.id,
			reason: typeof raw?.reason === "string" && raw.reason.trim() ? raw.reason : undefined,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That request is not valid." },
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.completeProject(parsed.data, actor));
	},
});
