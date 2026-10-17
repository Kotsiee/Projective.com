import {
	BUSINESS_AUTHORITY_REFUSAL,
	BUSINESS_AUTHORITY_SQLSTATE,
	type BusinessAuthorityDetails,
	BusinessAuthorityReason,
} from "@projective/types/workspace";

/** The parts of a PostgREST error the business-authority refusals fill. */
export interface BusinessAuthorityError {
	code?: string;
	message?: string;
	details?: string | null;
	hint?: string | null;
}

/** The envelope every door answers a business-authority refusal with. */
export interface BusinessAuthorityRefusal {
	status: 403;
	message: string;
	details: BusinessAuthorityDetails;
}

// `missing_permission: <capability>` (projects.fn_assert_business_actor, create_project, the basket
// doors) or `not_funder: <sentence>` (projects.fn_can_fund_project's doors).
const MISSING = /^(?:ERROR:\s*)?missing_permission:\s*([a-z_]+)/i;
const NOT_FUNDER = /^(?:ERROR:\s*)?not_funder:/i;

/**
 * The refusal code of a business-authority refusal (BB2), or `null` for any other error — a PK403 from
 * the earning gate, KYB or the persona gate is not one, and a `missing_permission` naming a capability
 * outside {@link BusinessAuthorityReason} is not either.
 */
export function businessAuthorityReason(
	error: BusinessAuthorityError | null | undefined,
): BusinessAuthorityReason | null {
	if (error?.code !== BUSINESS_AUTHORITY_SQLSTATE) return null;
	return reasonFromMessage(error.message ?? "");
}

/**
 * Map a business-authority refusal onto a 403 whose `details.reason` is the missing capability (or
 * `not_funder`), so a screen can word its own sentence (BU6); `null` when the error is not one.
 */
export function businessAuthorityRefusal(
	error: BusinessAuthorityError | null | undefined,
): BusinessAuthorityRefusal | null {
	return refusalFor(businessAuthorityReason(error));
}

/**
 * The same mapping for a caller that only kept the error's MESSAGE (`refusalFrom`): the errcode does
 * not travel in it, so the distinctive `missing_permission:` / `not_funder:` prefix is matched alone.
 */
export function businessAuthorityRefusalFromMessage(
	message: string,
): BusinessAuthorityRefusal | null {
	return refusalFor(reasonFromMessage(message));
}

function reasonFromMessage(message: string): BusinessAuthorityReason | null {
	if (NOT_FUNDER.test(message)) return "not_funder";
	const missing = MISSING.exec(message)?.[1]?.toLowerCase();
	const parsed = BusinessAuthorityReason.safeParse(missing);
	return parsed.success && parsed.data !== "not_funder" ? parsed.data : null;
}

function refusalFor(reason: BusinessAuthorityReason | null): BusinessAuthorityRefusal | null {
	if (!reason) return null;
	return { status: 403, message: BUSINESS_AUTHORITY_REFUSAL[reason], details: { reason } };
}
