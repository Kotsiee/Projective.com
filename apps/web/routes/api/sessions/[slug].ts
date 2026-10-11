import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";
import type { SessionWorkspace } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/sessions/[slug]` — a session engagement's workspace for the viewer: its
 * cohorts with real occupancy, their sittings, the viewer's seat and its funding, the curriculum with
 * their progress, and the join link (a URL only while the seat is funded and the join window is open).
 * The sidebar re-reads it when the join window opens. `workspace: null` for a non-session engagement
 * or a viewer without access.
 */
export const handler = define.handlers(
	defineReadRoute<{ workspace: SessionWorkspace | null }>({
		resolve: (ctx) => SessionBackendService.workspace(ctx.params.slug, readActor(ctx)),
		toBody: toProjectsBody,
	}),
);
