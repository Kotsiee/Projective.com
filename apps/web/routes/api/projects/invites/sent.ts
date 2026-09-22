import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { SentInvitesPage } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/invites/sent` — DEVELOPMENT ONLY. Every invitation the caller
 * has sent, grouped by project — the read behind the Dev Tools Invites window, whose Force Accept /
 * Force Reject controls act on these rows.
 *
 * The gate is the SERVER's `DENO_ENV`, read inside the fat {@link ProjectBackendService.sentInvites},
 * which answers a plain 404 anywhere but development. The three verbs come from
 * {@link defineReadRoute} so `HEAD` cannot drift from `GET`; the read is `private` (the default), as
 * anything keyed on a session cookie must be.
 */
export const handler = define.handlers(
	defineReadRoute<{ page: SentInvitesPage }>({
		resolve: (ctx) => ProjectBackendService.sentInvites(readActor(ctx)),
		toBody: toProjectsBody,
	}),
);
