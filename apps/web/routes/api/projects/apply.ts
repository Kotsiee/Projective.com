import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ApplyToProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/apply` — a freelancer applies, as themselves, to a stage (optionally one of its
 * staffing roles) of a live project. Zod-validated against {@link ApplyToProjectSchema}, then the fat
 * {@link ProjectBackendService.apply}: the application is recorded `pending` and the owner notified;
 * a cover note opens the request in the owner's Requests folder. 201 with the application.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to apply to a project." }, {
				status: 401,
			});
		}
		const parsed = ApplyToProjectSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json({ ok: false, message: "Check the highlighted fields.", errors }, {
				status: 422,
			});
		}
		return toProjectsResponse(await ProjectBackendService.apply(parsed.data, actor));
	},
});
