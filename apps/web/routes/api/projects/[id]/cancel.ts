import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CancelProjectSchema, PreviewProjectCancelSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `/api/projects/:id/cancel` — cancelling an engagement of any kind, a client's brief or a bought
 * service (Decisions #456, #467). Thin route: validate the address and body, then delegate to the fat
 * {@link ProjectBackendService}.
 *
 * - `GET` — what cancelling settles (`projects.preview_project_cancel`): what comes back at once and
 *   three Fair Exit quotes per stage holding claimed work. The dialog renders these and computes none.
 * - `POST` — `{ tiers: { [stageId]: 25 | 50 | 75 }, reason? }` → `projects.cancel_project`, the one
 *   settle-first door. An open dispute answers 409 `dispute_open`.
 *
 * **No capability guard** — both functions check review authority themselves (Decision #53(b)); the
 * 401 below only establishes who is asking.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to cancel a project." }, { status: 401 });
		}
		const parsed = PreviewProjectCancelSchema.safeParse({ projectId: ctx.params.id });
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That project address is not valid." },
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.previewProjectCancel(parsed.data, actor));
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to cancel a project." }, { status: 401 });
		}
		const raw = await ctx.req.json().catch(() => null) as
			| { tiers?: unknown; reason?: unknown }
			| null;
		const parsed = CancelProjectSchema.safeParse({
			projectId: ctx.params.id,
			tiers: raw?.tiers ?? {},
			reason: typeof raw?.reason === "string" && raw.reason.trim() ? raw.reason : undefined,
		});
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Choose 25, 50 or 75% for each stage with claimed work.", errors },
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.cancelProject(parsed.data, actor));
	},
});
