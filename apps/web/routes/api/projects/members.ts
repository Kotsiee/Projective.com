import { define } from "@web/utils/state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { MemberRosterParams, ProjectFormat } from "@projective/types/projects";

/**
 * `/api/projects/members` — the thin route for the Members roster read. HTTP parse + a light param
 * guard, then delegate to the fat {@link ProjectBackendService.members} and map its
 * {@link ServiceResult} to a `Response` via {@link toProjectsResponse}. The Zod SSOT
 * (`MemberRosterParamsSchema`) is the shape contract; the route hand-validates the one required param
 * (`projectId`) and coerces the rest, exactly as the sibling `files`/`messages` routes do. Islands
 * never reach the backend — they fetch this via the dumb `MembersService`.
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

export const handler = define.handlers({
	GET(ctx) {
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

		return toProjectsResponse(
			ProjectBackendService.members({
				projectId,
				channelId: channelId || null,
				simViewer,
				simProjectType,
				simPendingInvites,
			}),
		);
	},
});
