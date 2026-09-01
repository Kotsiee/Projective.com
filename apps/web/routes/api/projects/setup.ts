import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectSetup } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/setup?slug=…` — thin route: guard the required slug, then
 * delegate to the fat {@link ProjectBackendService} for the owner's editable configuration and its
 * derived setup ladder (`steps` · `completeness` · `previewReady`).
 *
 * This is a separate read from `/api/projects/detail` because the two answer different questions.
 * Detail is the sidebar's showcase projection and carries no price, role or rule, so a progress bar
 * built on it could only ever count a title. Setup is the configuration itself.
 *
 * `completeness` and `previewReady` are SERVER-derived here and nowhere else, so the bar the owner
 * reads and the gate that unlocks Preview are the same number. All three verbs come from
 * {@link defineReadRoute}, which resolves the payload once and derives the responses from it, so
 * `HEAD` cannot drift from `GET`. The missing-slug guard returns its `Response` from inside `resolve`
 * for that same reason: the factory strips the body for `HEAD`, and a hand-written `GET` guard would
 * answer one verb and not the other.
 */
export const handler = define.handlers(
	defineReadRoute<{ setup: ProjectSetup }>({
		resolve: (ctx) => {
			const slug = ctx.url.searchParams.get("slug");
			if (!slug) {
				return Response.json({ ok: false, message: "Missing project slug." }, { status: 400 });
			}
			return ProjectBackendService.setup(slug, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
