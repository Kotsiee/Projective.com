import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { type HireBrief, HireInvitationSchema } from "@projective/types/projects";
import { toProjectsBody, toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/projects/hire?projectId=<slug>` — the brief a client's profile-side
 * "Hire" invitation modal opens on: the project overview, its stages with their configured prices,
 * the existing roster with each member's stages, and the pricing model the engagement's shape
 * implies. Delegates to the fat {@link ProjectBackendService.hireBrief}, which COMPOSES the two
 * reads the owner already has rather than reading the project a fourth way.
 *
 * `POST /api/projects/hire` — send the invitation: Zod-validate the payload and delegate to the fat
 * {@link ProjectBackendService.hire}, which re-validates it against the same brief through the same
 * rule the modal used to gate its Send control.
 *
 * The three read verbs come from {@link defineReadRoute} (one resolver; `HEAD` cannot drift from
 * `GET`, and `ETag` revalidation is identical on both). A brief is only ever a signed-in client's,
 * so the 401 is the service's own and the read is `private` — the factory's default.
 */
const read = defineReadRoute<{ brief: HireBrief }>({
	resolve: (ctx) => {
		const projectId = ctx.url.searchParams.get("projectId");
		if (!projectId) {
			return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
		}
		return ProjectBackendService.hireBrief(projectId, readActor(ctx));
	},
	toBody: toProjectsBody,
	// This route also serves POST (send the invitation), so `Allow` and the preflight must say so.
	alsoAllows: ["POST"],
});

export const handler = define.handlers({
	...read,
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to invite someone to a project." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = HireInvitationSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.hire(parsed.data, actor));
	},
});
