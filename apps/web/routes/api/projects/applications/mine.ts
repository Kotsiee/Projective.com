import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SentApplicationsQuerySchema } from "@projective/types/projects";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET /api/projects/applications/mine[?project=<slug>]` — the proposals the viewer has sent (and those
 * filed for a team they belong to), newest first. Zod-validated, then the fat
 * {@link ProjectBackendService.sentApplications}. `no-store`: a withdrawal must show on the next read.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const parsed = SentApplicationsQuerySchema.safeParse({
			project: ctx.url.searchParams.get("project") ?? undefined,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That project couldn't be read.", errors: { project: "invalid" } },
				{ status: 400 },
			);
		}
		const result = await ProjectBackendService.sentApplications(parsed.data, readActor(ctx));
		return Response.json(toProjectsBody(result), {
			status: result.status,
			headers: { "Cache-Control": "no-store" },
		});
	},
});
