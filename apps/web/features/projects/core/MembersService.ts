import { getProjects, postProjects } from "./api.ts";
import type {
	InviteActionInput,
	InviteDecisionInput,
	MemberInvite,
	MemberRosterPage,
	MemberRosterParams,
	MemberScope,
	RemoveMemberInput,
	RemoveMemberResult,
	SentInvitesPage,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * MembersService — the dumb client service for the Members roster read and the membership writes. It
 * builds the query string or the JSON body and calls the transport helpers ({@link getProjects} /
 * {@link postProjects}), returning a soft {@link ProjectsResult}; it never throws, so the roster
 * island stays dumb (mirrors {@link FilesService}). The island uses the read for the DEV-seam
 * re-simulation refetch (persona / project type / pending-invite toggles); everyday search/role/stage
 * filtering is a pure client-side pass over the bounded roster (no round-trip).
 *
 * **Scope routing.** The roster is mounted by BOTH route hierarchies, so the endpoint is chosen from
 * the scope rather than duplicated per feature: an engagement scope reads `/api/projects/members`, the
 * global-inbox `conversation` scope reads `/api/messaging/members`. Both answer the identical
 * `MemberRosterPage` contract.
 *
 * **Writes.** `cancelInvite` / `dismissInvite` are the client's two acts on an invitation record;
 * `removeMember` undoes an acceptance (or removes any active participant) with the consequences the
 * fat service applies; `decideInvite` and `sentInvites` are the Dev Tools Invites window's pair —
 * development-only on the server, which answers 404 anywhere else.
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

	/** Withdraw an open offer. The row becomes `revoked` and leaves the list; no cooldown starts. */
	cancelInvite(
		projectId: string,
		inviteId: string,
	): Promise<ProjectsResult<{ inviteId: string; action: InviteActionInput["action"] }>> {
		const body: InviteActionInput = { projectId, inviteId, action: "cancel" };
		return postProjects("/api/projects/invites", body);
	},

	/** Acknowledge a declined or expired record and take it off the list. The answer underneath is kept. */
	dismissInvite(
		projectId: string,
		inviteId: string,
	): Promise<ProjectsResult<{ inviteId: string; action: InviteActionInput["action"] }>> {
		const body: InviteActionInput = { projectId, inviteId, action: "dismiss" };
		return postProjects("/api/projects/invites", body);
	},

	/**
	 * Remove a participant from the project, or — with a `stageId` — unassign them from one stage. The
	 * server applies the consequences (`removalNotices`) and reports the counts it touched.
	 */
	removeMember(input: RemoveMemberInput): Promise<ProjectsResult<RemoveMemberResult>> {
		return postProjects<RemoveMemberResult>("/api/projects/members/remove", input);
	},

	/** DEV ONLY — force an invitee's answer to one of the viewer's own invitations. */
	decideInvite(
		input: InviteDecisionInput,
	): Promise<ProjectsResult<{ invite: MemberInvite | null }>> {
		return postProjects<{ invite: MemberInvite | null }>("/api/projects/invites/decide", input);
	},

	/** DEV ONLY — every invitation the viewer has sent, grouped by project. */
	sentInvites(): Promise<ProjectsResult<{ page: SentInvitesPage }>> {
		return getProjects<{ page: SentInvitesPage }>("/api/projects/invites/sent");
	},
};
