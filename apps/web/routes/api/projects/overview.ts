import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectOverview } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/overview?slug=…` — thin route: guard the required slug, then
 * delegate to the fat {@link ProjectBackendService} for the member's dashboard projection on one
 * engagement (hero · recent updates · channels · the viewer's own assignments · the viewer's own
 * money).
 *
 * The finance block is viewer-pertinent by construction — what is escrowed, released and pending for
 * the person asking, never the engagement's whole ledger — and every figure arrives as a
 * server-computed `MoneyView`. Nothing downstream totals, splits or converts.
 *
 * All three verbs come from {@link defineReadRoute}; the missing-slug guard returns its `Response`
 * from inside `resolve` so the factory can strip the body for `HEAD` and keep the two verbs identical.
 */
export const handler = define.handlers(
	defineReadRoute<{ overview: ProjectOverview }>({
		resolve: (ctx) => {
			const slug = ctx.url.searchParams.get("slug");
			if (!slug) {
				return Response.json({ ok: false, message: "Missing project slug." }, { status: 400 });
			}
			return ProjectBackendService.overview(slug, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
