import { getProjects, postProjects } from "./api.ts";
import type {
	DisputeCase,
	DisputeOfferInput,
	DisputeRespondInput,
	DisputeStatus,
	OpenTicketDisputeInput,
	TicketDisputeState,
} from "@projective/types/finance";
import type { ProjectsResult } from "../types/results.ts";

/**
 * DisputeService — the dumb client service for a no-show or ticket dispute (Decisions #212, #548). It
 * builds the URL or the JSON body and calls the transport helpers, returning a soft
 * {@link ProjectsResult}; who may raise, respond, offer or accept, when a case escalates and what a
 * ruling moves are the database's. A no-show claim is opened through `SessionService.claimNoShow`; an
 * operator's ruling (`POST …/resolve`) has no island caller.
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

	/** A ticket's dispute state for the viewer: the live case, and whether one may be raised now. */
	ticketState(ticketId: string): Promise<ProjectsResult<{ state: TicketDisputeState }>> {
		return getProjects(`/api/finance/disputes/ticket/${encodeURIComponent(ticketId)}`);
	},

	/** Raise a dispute on a ticket's money on one stage. */
	open(
		input: OpenTicketDisputeInput,
	): Promise<ProjectsResult<{ disputeId: string; status: DisputeStatus }>> {
		return postProjects("/api/finance/disputes", input);
	},

	/** Offer the freelancer's share of a ticket case's money. */
	offer(disputeId: string, input: DisputeOfferInput): Promise<ProjectsResult<{ offerId: string }>> {
		return postProjects(`/api/finance/disputes/${encodeURIComponent(disputeId)}/offers`, input);
	},

	/** Accept the other side's standing offer; the case settles on it. */
	accept(disputeId: string, offerId: string): Promise<ProjectsResult<{ status: DisputeStatus }>> {
		return postProjects(
			`/api/finance/disputes/${encodeURIComponent(disputeId)}/offers/${
				encodeURIComponent(offerId)
			}/accept`,
			{},
		);
	},
};
