import { define } from "@web/utils/state.ts";
import { CreateProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/create` — thin route: Zod-validate the Create-Project payload (name + type are
 * the only hard requirements), map any issues to field errors, then delegate to the fat
 * {@link ProjectBackendService}. Persistence is stubbed until `PROJECTS_BACKEND_LIVE` lands.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateProjectSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}
		return toProjectsResponse(ProjectBackendService.create(parsed.data));
	},
});
