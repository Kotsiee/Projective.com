import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { parseProjectParams } from "@features/projects/core/projects-state.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectFeedPayload } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/list` — the feed query (scope + facets + quick + search).
 *
 * Thin by contract: parse the query, resolve the acting reader from the session, delegate to the fat
 * {@link ProjectBackendService}. The feed island calls this via `ProjectSidebarService` for every
 * client-side refinement; the `/projects` route handler calls the service directly for SSR first
 * paint.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match`
 * revalidation is identical on both. See that module for the caching and CORS decisions.
 *
 * **No session guard, deliberately, and the reason is worth stating.** `routes/api/` sits outside the
 * `(dashboard)` group, so that group's guest bounce never runs here; a signed-out caller reaches this
 * route and gets the fixture corpus, which belongs to nobody. Once `PROJECTS_BACKEND_LIVE` is on, the
 * live branch requires a resolvable actor and RLS under that actor's own JWT is the real gate —
 * `anon` holds no USAGE on the `projects` schema at all, so an unauthenticated live read cannot
 * return rows even by accident.
 */
export const handler = define.handlers(
	defineReadRoute<ProjectFeedPayload>({
		resolve: (ctx) =>
			ProjectBackendService.list(parseProjectParams(ctx.url.searchParams), readActor(ctx)),
		toBody: toProjectsBody,
	}),
);
