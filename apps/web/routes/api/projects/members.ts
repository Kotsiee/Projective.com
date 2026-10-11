import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { MemberRosterParamsSchema, ProjectFormat } from "@projective/types/projects";
import type { MemberRosterPage } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/members` — the thin route for the Members roster read. HTTP
 * parse + a light param guard, then delegate to the fat {@link ProjectBackendService.members} and
 * map its {@link ServiceResult} to the client body via {@link toProjectsBody}. The Zod SSOT
 * (`MemberRosterParamsSchema`) is the shape contract; the route hand-validates the one required param
 * (`projectId`) and coerces the rest, exactly as the sibling `files`/`messages` routes do. Islands
 * never reach the backend — they fetch this via the dumb `MembersService`.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`projectId` guard returns its 400 from inside the resolver for
 * the same reason: the factory strips the body for `HEAD`, so the refusal cannot leak a body through
 * a verb that must not carry one.
 *
 * The `sim*` params are DEV-ONLY simulation hints the Dev Tools Context Switcher passes; the live path
 * ignores them (the real viewer role + engagement format + invitation table are authoritative).
 */


export const handler = define.handlers(
	defineReadRoute<{ page: MemberRosterPage }>({
		resolve: (ctx) => {
			const sp = ctx.url.searchParams;
			const projectId = sp.get("projectId");
			if (!projectId) {
				return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
			}

			const channelId = sp.get("channelId");
			const simViewerRaw = sp.get("simViewer");
			const simTypeRaw = sp.get("simProjectType");
			const simInvitesRaw = sp.get("simPendingInvites");
			const simRequestsRaw = sp.get("simPendingRequests");

			const simViewer = MemberRosterParamsSchema.shape.simViewer.safeParse(simViewerRaw).data;
			const simProjectType = ProjectFormat.safeParse(simTypeRaw).data;
			const simPendingInvites = simInvitesRaw === null
				? undefined
				: simInvitesRaw === "true" || simInvitesRaw === "1";
			const simPendingRequests = simRequestsRaw === null
				? undefined
				: simRequestsRaw === "true" || simRequestsRaw === "1";

			return ProjectBackendService.members({
				projectId,
				channelId: channelId || null,
				simViewer,
				simProjectType,
				simPendingInvites,
				simPendingRequests,
			}, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
