import {
	PAYOUT_GATE_SQLSTATE,
	PAYOUT_NOT_READY_REASON,
	PAYOUT_NOT_READY_REFUSAL,
	PAYOUT_SETUP_HREF,
	PayoutGateActor,
	type PayoutGateDetails,
} from "@projective/types/finance";

/** The parts of a PostgREST error the earning gate fills. */
export interface PayoutGateError {
	code?: string;
	message?: string;
	details?: string | null;
	hint?: string | null;
}

/** The envelope every door answers a payout-not-ready refusal with. */
export interface PayoutGateRefusal {
	status: 403;
	message: string;
	details: PayoutGateDetails;
}

const PREFIX = new RegExp(`^(?:ERROR:\\s*)?${PAYOUT_NOT_READY_REASON}:\\s*`, "i");

/**
 * Whether a database refusal is the earning gate's — `finance.fn_assert_payout_ready` refusing a door
 * that would land a gig or seat a team member (SQLSTATE `PK403`, message `payout_not_ready: …`,
 * Decision #196). Other PK403s (KYB, withdrawal) are not.
 */
export function isPayoutNotReady(error: PayoutGateError | null | undefined): boolean {
	return error?.code === PAYOUT_GATE_SQLSTATE && PREFIX.test(error.message ?? "");
}

/**
 * Map the gate's refusal onto a 403 whose `details` say who must act and, when it is the caller, link
 * to Settings → Verification. Team members' handles pass through only as the database chose to give
 * them (to a team lead).
 */
export function payoutNotReadyRefusal(error: PayoutGateError): PayoutGateRefusal {
	const actor = PayoutGateActor.catch("other").parse(error.hint ?? undefined);
	const reason = (error.message ?? "").replace(PREFIX, "").replace(/\s+/g, " ").trim();
	const members = error.details?.trim() || null;
	return {
		status: 403,
		message: reason ? sentence(reason) : PAYOUT_NOT_READY_REFUSAL,
		details: {
			reason: PAYOUT_NOT_READY_REASON,
			actor,
			href: actor === "self" ? PAYOUT_SETUP_HREF : null,
			members,
		},
	};
}

function sentence(reason: string): string {
	const capital = reason[0].toUpperCase() + reason.slice(1);
	return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
