import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectSummary } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/item?slug=…` — thin route: guard the required slug, then
 * delegate to the fat {@link ProjectBackendService} for a single engagement projection (deep-link
 * prefetch / row focus).
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-slug guard returns its `Response` from inside `resolve` for the
 * same reason: the factory strips the body for `HEAD`, so a guard cannot answer one verb and not the
 * other, and cannot leak a body through `HEAD`.
 */
export const handler = define.handlers(
	defineReadRoute<{ item: ProjectSummary }>({
		resolve: (ctx) => {
			const slug = ctx.url.searchParams.get("slug");
			if (!slug) {
				return Response.json({ ok: false, message: "Missing project slug." }, { status: 400 });
			}
			return ProjectBackendService.item(slug, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
