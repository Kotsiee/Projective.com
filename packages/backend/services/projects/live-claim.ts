import type { ClaimTicket } from "@projective/types/projects";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { isPayoutNotReady, payoutNotReadyRefusal } from "../../core/payout-gate.ts";
import type { ReadActor } from "../read-actor.ts";
import { projectsDb, UUID_RE } from "./live-support.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";

/** The parts of a PostgREST error the claim refusals read. */
export interface ClaimDbError {
	code?: string;
	message: string;
	details?: string | null;
	hint?: string | null;
}

/** The refusals a claim answers in its own words, shared by the live and stub paths. */
export const CLAIM_REFUSAL = {
	needsFunding: {
		status: 402,
		message:
			"The client hasn't funded this ticket yet. We've asked them to — you can claim it once " +
			"its escrow is held.",
		errors: { ticket: "needs_funding" },
	},
	alreadyClaimed: {
		status: 409,
		message: "Someone else claimed this ticket first.",
		errors: { ticket: "already_claimed" },
	},
	undescribed: {
		status: 422,
		message: "The client has to describe this ticket before anyone can claim it.",
		errors: { ticket: "description_required" },
	},
	notOpenPull: {
		status: 422,
		message: "Tickets on this stage are assigned by the project owner, not claimed.",
		errors: { ticket: "not_open_pull" },
	},
} as const satisfies Record<string, WriteRefusal>;

/**
 * Map a `projects.claim_ticket` failure onto a refusal the board can show as it stands: the earning
 * gate (with its fix link in `details`), the age gate, the concurrency caps, a lost race, an
 * undescribed ticket and a stage that does not open-pull. Anything else falls through to
 * {@link refusalFrom}.
 */
export function claimRefusal(error: ClaimDbError): WriteRefusal {
	if (isPayoutNotReady(error)) {
		const refusal = payoutNotReadyRefusal(error);
		return {
			status: refusal.status,
			message: refusal.message,
			errors: { ticket: refusal.details.reason },
			details: refusal.details,
		};
	}
	if (isAgeRestricted(error)) {
		return {
			status: AGE_RESTRICTED.status,
			message: AGE_RESTRICTED.message,
			errors: { ticket: AGE_RESTRICTED.reason },
		};
	}
	const message = error.message;
	if (message.includes("over your cap") || message.includes("over the stage cap")) {
		return { status: 409, message, errors: { ticket: "over_capacity" } };
	}
	if (message.includes("routed by the project owner")) return CLAIM_REFUSAL.notOpenPull;
	if (message.includes("already been claimed")) return CLAIM_REFUSAL.alreadyClaimed;
	if (message.includes("description is required")) return CLAIM_REFUSAL.undescribed;
	if (error.code === "42501") return { status: 403, message, errors: { ticket: "not_permitted" } };
	return refusalFrom(message, "ticket");
}

/**
 * Self-claim one ticket through `projects.claim_ticket` in the caller's JWT, and return its id.
 *
 * The RPC answers `NULL` when the escrow hold was refused: the claim did not happen and the ticket is
 * now Needs funding, with the client notified (Decision #165). That is a refusal, not a success.
 */
export async function claimTicketRow(
	actor: ReadActor & { accessToken: string },
	input: ClaimTicket,
): Promise<WriteOutcome<string>> {
	if (!UUID_RE.test(input.ticketId) || !actor.userId) return null;
	const { data, error } = await projectsDb(actor).rpc("claim_ticket", {
		p_ticket_id: input.ticketId,
		p_assignee_id: actor.userId,
	});
	if (error) {
		if (error.code === "P0002") return null;
		return { refusal: claimRefusal(error) };
	}
	if (data === null) return { refusal: CLAIM_REFUSAL.needsFunding };
	return { data: input.ticketId };
}
