import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type {
	MemberRosterPage,
	MemberRosterParams,
	ProjectFormat,
} from "@projective/types/projects";

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

const SIM_VIEWERS: readonly NonNullable<MemberRosterParams["simViewer"]>[] = [
	"owner_admin",
	"manager",
	"freelancer_assigned",
	"freelancer_unassigned",
];
const FORMATS: readonly ProjectFormat[] = ["one_off", "pipeline", "session"];

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

			const simViewer = simViewerRaw && SIM_VIEWERS.includes(simViewerRaw as never)
				? (simViewerRaw as MemberRosterParams["simViewer"])
				: undefined;
			const simProjectType = simTypeRaw && FORMATS.includes(simTypeRaw as ProjectFormat)
				? (simTypeRaw as ProjectFormat)
				: undefined;
			const simPendingInvites = simInvitesRaw === null
				? undefined
				: simInvitesRaw === "true" || simInvitesRaw === "1";

			return ProjectBackendService.members({
				projectId,
				channelId: channelId || null,
				simViewer,
				simProjectType,
				simPendingInvites,
			}, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
