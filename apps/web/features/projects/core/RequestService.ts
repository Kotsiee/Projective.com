import { postProjects } from "./api.ts";
import type {
	ApplicationAccepted,
	ApplyToProject,
	InvitationAnswered,
	ProjectApplication,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * RequestService — the THIN client side of the hiring handshake: a freelancer applies to a stage, an
 * invitee answers a request, a client confirms an applicant's seat. One POST per verb; the fat
 * `ProjectBackendService` owns every rule, the notification and the conversation each one opens.
 */
export const RequestService = {
	/** Apply to a stage; a cover note opens the conversation with the client. */
	apply(payload: ApplyToProject): Promise<ProjectsResult<ProjectApplication>> {
		return postProjects<ProjectApplication>("/api/projects/apply", payload);
	},

	/** Accept or decline every invitation of one request together. */
	respond(invitationIds: string[], accept: boolean): Promise<ProjectsResult<InvitationAnswered>> {
		return postProjects<InvitationAnswered>("/api/projects/invites/respond", {
			invitationIds,
			accept,
		});
	},

	/** Confirm an applicant's seat; answers with where the seat is funded. */
	acceptApplication(applicationId: string): Promise<ProjectsResult<ApplicationAccepted>> {
		return postProjects<ApplicationAccepted>("/api/projects/applications/accept", {
			applicationId,
		});
	},
};
