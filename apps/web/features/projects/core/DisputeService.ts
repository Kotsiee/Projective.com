import { getProjects, postProjects } from "./api.ts";
import type { DisputeCase, DisputeRespondInput, DisputeStatus } from "@projective/types/finance";
import type { ProjectsResult } from "../types/results.ts";

/**
 * DisputeService — the dumb client service for a no-show dispute (Decision #212). It builds the URL or
 * the JSON body and calls the transport helpers, returning a soft {@link ProjectsResult}; who may
 * respond, when a case escalates and what a ruling moves are the database's. A claim is opened through
 * `SessionService.claimNoShow`; an operator's ruling (`POST …/resolve`) has no island caller.
 */
export const DisputeService = {
	/** The case as the viewer may see it. */
	get(disputeId: string): Promise<ProjectsResult<{ dispute: DisputeCase }>> {
		return getProjects(`/api/finance/disputes/${encodeURIComponent(disputeId)}`);
	},

	/** File a statement with the viewer's uploaded evidence files. */
	respond(
		disputeId: string,
		input: DisputeRespondInput,
	): Promise<ProjectsResult<{ status: DisputeStatus }>> {
		return postProjects(`/api/finance/disputes/${encodeURIComponent(disputeId)}/respond`, input);
	},

	/** Send an awaiting-response case to an auditor now. */
	escalate(disputeId: string): Promise<ProjectsResult<{ status: DisputeStatus }>> {
		return postProjects(`/api/finance/disputes/${encodeURIComponent(disputeId)}/escalate`, {});
	},
};
