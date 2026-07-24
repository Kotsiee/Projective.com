import { getProjects } from "./api.ts";
import type { MemberRosterPage, MemberRosterParams, MemberScope } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * MembersService — the dumb client service for the Members roster read. It builds the query string and
 * calls the transport helper {@link getProjects}, returning a soft {@link ProjectsResult}; it never
 * throws, so the roster island stays dumb (mirrors {@link FilesService}). The island uses it for the
 * DEV-seam re-simulation refetch (persona / project type / pending-invite toggles); everyday
 * search/role/stage filtering is a pure client-side pass over the bounded roster (no round-trip).
 *
 * **Scope routing.** The roster is mounted by BOTH route hierarchies, so the endpoint is chosen from
 * the scope rather than duplicated per feature: an engagement scope reads `/api/projects/members`, the
 * global-inbox `conversation` scope reads `/api/messaging/members`. Both answer the identical
 * `MemberRosterPage` contract.
 */
export const MembersService = {
	list(
		params: MemberRosterParams & { scope?: MemberScope },
	): Promise<ProjectsResult<{ page: MemberRosterPage }>> {
		if (params.scope === "conversation") {
			const id = params.channelId || params.projectId;
			return getProjects<{ page: MemberRosterPage }>(
				`/api/messaging/members?conversationId=${encodeURIComponent(id)}`,
			);
		}
		const qs = new URLSearchParams({ projectId: params.projectId });
		if (params.channelId) qs.set("channelId", params.channelId);
		if (params.simViewer) qs.set("simViewer", params.simViewer);
		if (params.simProjectType) qs.set("simProjectType", params.simProjectType);
		if (params.simPendingInvites !== undefined) {
			qs.set("simPendingInvites", params.simPendingInvites ? "true" : "false");
		}
		return getProjects<{ page: MemberRosterPage }>(`/api/projects/members?${qs.toString()}`);
	},
};
