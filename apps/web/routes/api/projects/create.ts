import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/create` — thin route: Zod-validate the Create-Project payload (a name is the
 * only hard requirement), map any issues to field errors, then delegate to the fat
 * {@link ProjectBackendService}, which persists the engagement and returns the two identifiers it can
 * be addressed by.
 *
 * **The session has to reach the service.** Everything a create writes is scoped to the acting
 * identity — the owner column, the workspace it is filed under, the RLS context the whole insert runs
 * in — so an actor is not optional plumbing here, it is the subject of the write. The route
 * previously called the service with the payload alone, which is why nothing could be persisted.
 *
 * **No capability guard.** A server-side owner/`isFreelancer` bounce is forbidden: the Dev Context
 * Switcher's persona is a client seam the server never sees, so the gate would fire on a simulated
 * persona. RLS is the real gate (Decision #53(b)). The 401 below is an identity check, not a
 * capability one — a project has to belong to somebody.
 *
 * One caveat about that 401, worth knowing rather than working around: the client reaches this route
 * through `apiFetch`, which treats an unrecoverable 401 as an expired session and navigates to
 * `/login`. So the message below is a correct HTTP answer that no human reads on this surface — the
 * modal's error line never renders it, because the document is already unloading.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to create a project." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateProjectSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.create(parsed.data, actor));
	},
});
