import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { TimelinePage } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/timeline` — the thin route for the Timeline / Gantt read. HTTP
 * parse + light param guard, then delegate to the fat {@link ProjectBackendService.timeline} and map
 * its {@link ServiceResult} to the client body via {@link toProjectsBody}. `channelId` selects one
 * stage's timeline; unset → the whole engagement. The Zod SSOT (`TimelineListParamsSchema`) is the
 * shape contract. Islands never reach the backend — they fetch this via the dumb `TimelineService`.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it, so `HEAD` cannot drift from `GET` and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`projectId` guard returns its 400 from inside `resolve` for the
 * same reason (see `board.ts`).
 */
export const handler = define.handlers(
	defineReadRoute<{ page: TimelinePage }>({
		resolve: (ctx) => {
			const projectId = ctx.url.searchParams.get("projectId");
			if (!projectId) {
				return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
			}
			const channelId = ctx.url.searchParams.get("channelId");
			return ProjectBackendService.timeline(
				{ projectId, channelId: channelId || null },
				readActor(ctx),
			);
		},
		toBody: toProjectsBody,
	}),
);
