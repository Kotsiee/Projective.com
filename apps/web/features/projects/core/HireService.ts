import { getProjects, postProjects } from "./api.ts";
import type { HireBrief, HireInvitation, MemberInvite } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * HireService — the THIN client service behind a client's profile-side "Hire" invitation modal.
 *
 * Two methods, mirroring the two verbs of `/api/projects/hire`: the brief the modal renders from,
 * and the invitation it sends. A dumb object — no fixtures, no arithmetic, no validation of its own;
 * the fat `ProjectBackendService` owns the composition and the rule. Requests go through
 * `apiFetch`, so an expired session on a live read is refreshed and retried rather than surfacing as
 * a bare failure (Decision #46).
 *
 * Lives in the projects feature although its caller is the profile hero: the endpoint, the shapes
 * and the write all belong to the projects domain, and a second transport in the profile feature
 * would be one more `fetch` to keep in step with `respond.ts`.
 */
export const HireService = {
	/** The invitation brief for one of the viewer's own projects, by route slug. */
	brief(projectId: string): Promise<ProjectsResult<{ brief: HireBrief }>> {
		const qs = new URLSearchParams({ projectId });
		return getProjects<{ brief: HireBrief }>(`/api/projects/hire?${qs.toString()}`);
	},

	/** Send the invitation. The server re-validates it against the brief before recording it. */
	invite(
		payload: HireInvitation,
	): Promise<ProjectsResult<{ invites: MemberInvite[]; total: number }>> {
		return postProjects<{ invites: MemberInvite[]; total: number }>("/api/projects/hire", payload);
	},
};
