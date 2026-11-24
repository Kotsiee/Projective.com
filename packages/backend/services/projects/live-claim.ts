import type {
	AssignTicket,
	ClaimTicket,
	DeclineTicketPin,
	SetStageAssignmentMode,
} from "@projective/types/projects";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { legalAcceptanceRefusal } from "../../core/legal-gate.ts";
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
	notOpen: {
		status: 422,
		message: "This ticket isn't open to claim yet.",
		errors: { ticket: "not_open" },
	},
} as const satisfies Record<string, WriteRefusal>;

/**
 * Map a `projects.claim_ticket` failure onto a refusal the board can show as it stands: the earning
 * gate (with its fix link in `details`), the IP Transfer Deed not yet accepted at the version in effect
 * (409 `legal_acceptance_required`, LG3), the age gate, the concurrency caps, a lost race, an
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
	const legal = legalAcceptanceRefusal(error);
	if (legal) return { ...legal, errors: { ticket: legal.details.reason } };
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
		p_legal: input.legalAcceptance ?? null,
	});
	if (error) {
		if (error.code === "P0002") return null;
		return { refusal: claimRefusal(error) };
	}
	if (data === null) return { refusal: CLAIM_REFUSAL.needsFunding };
	return { data: input.ticketId };
}

// #region Manual assignment (Decision #547)

/**
 * Map a routing, pin or decline door's failure (`set_stage_assignment_mode`, `assign_ticket_manual`,
 * `decline_ticket_pin`) onto a refusal. Each door words its rules for the reader: a planned mode
 * (`0A000`), a check (`23514`: not manual, no live seat, over a cap, not open) and a refusal of this
 * caller (`42501`). The payout gate names the assignee here, never the caller. `missing_permission:
 * hire` and anything else fall through to {@link refusalFrom}.
 */
export function pinRefusal(error: ClaimDbError, field = "ticket"): WriteRefusal {
	if (isPayoutNotReady(error)) {
		return {
			status: 409,
			message: "That freelancer can't be paid yet, so no work can be assigned to them.",
			errors: { [field]: "payout_not_ready" },
		};
	}
	if (error.code === "0A000") {
		return { status: 422, message: error.message, errors: { mode: "planned" } };
	}
	if (error.code === "23514") {
		return { status: 409, message: error.message, errors: { [field]: "not_allowed" } };
	}
	if (error.code === "42501" && !error.message.startsWith("permission denied")) {
		return { status: 403, message: error.message, errors: { [field]: "not_permitted" } };
	}
	return refusalFrom(error.message, field);
}

/** Route one stage by open pull or by hand, through `projects.set_stage_assignment_mode`. */
export async function setStageAssignmentModeRow(
	actor: ReadActor & { accessToken: string },
	input: SetStageAssignmentMode,
): Promise<WriteOutcome<string>> {
	if (!UUID_RE.test(input.stageId)) return null;
	const { error } = await projectsDb(actor).rpc("set_stage_assignment_mode", {
		p_stage_id: input.stageId,
		p_mode: input.mode,
	});
	if (error) {
		return error.code === "P0001" && error.message.includes("not found")
			? null
			: { refusal: pinRefusal(error, "mode") };
	}
	return { data: input.stageId };
}

/** Pin one ticket to a live-seat holder, through `projects.assign_ticket_manual`. Holds nothing. */
export async function assignTicketRow(
	actor: ReadActor & { accessToken: string },
	input: AssignTicket,
): Promise<WriteOutcome<string>> {
	if (!UUID_RE.test(input.ticketId) || !UUID_RE.test(input.assigneeId)) return null;
	const { error } = await projectsDb(actor).rpc("assign_ticket_manual", {
		p_ticket_id: input.ticketId,
		p_assignee_id: input.assigneeId,
	});
	if (error) {
		return error.code === "P0001" && error.message.includes("not found")
			? null
			: { refusal: pinRefusal(error) };
	}
	return { data: input.ticketId };
}

/** The pinned freelancer declines, through `projects.decline_ticket_pin`. Nothing was held. */
export async function declineTicketPinRow(
	actor: ReadActor & { accessToken: string },
	input: DeclineTicketPin,
): Promise<WriteOutcome<string>> {
	if (!UUID_RE.test(input.ticketId)) return null;
	const { error } = await projectsDb(actor).rpc("decline_ticket_pin", {
		p_ticket_id: input.ticketId,
	});
	if (error) return error.code === "P0002" ? null : { refusal: pinRefusal(error) };
	return { data: input.ticketId };
}

// #endregion

/** The pin doors' refusals in their own words, shared by the live and stub paths (stub parity). */
export const PIN_REFUSAL = {
	notPermitted: {
		status: 403,
		message: "Only the project owner may pin an assignee.",
		errors: { ticket: "not_permitted" },
	},
	notManual: {
		status: 409,
		message: "Only a ticket on a stage set to manual assignment can be assigned to someone.",
		errors: { ticket: "not_allowed" },
	},
	noSeat: {
		status: 409,
		message: "That person is not hired on this ticket's stage, so it cannot be assigned to them.",
		errors: { ticket: "not_allowed" },
	},
	notOpen: {
		status: 409,
		message: "This ticket is not open to claim.",
		errors: { ticket: "not_allowed" },
	},
	notYours: {
		status: 403,
		message: "Only the freelancer this ticket is assigned to can decline it.",
		errors: { ticket: "not_permitted" },
	},
} as const satisfies Record<string, WriteRefusal>;
