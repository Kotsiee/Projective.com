import {
	AGE_RESTRICTED_REASON,
	AGE_SQLSTATE,
	DM_SHIELD_REFUSAL,
	RESTRICTED_REFUSAL,
} from "@projective/types/auth";

/**
 * Whether a database refusal is the age gate's — `org.fn_assert_adult` refusing a 13–17 account at a
 * buy/sell door (SQLSTATE `PM403`, Decision #190).
 */
export function isAgeRestricted(error: { code?: string } | null | undefined): boolean {
	return error?.code === AGE_SQLSTATE.restricted;
}

/** The refusal a direct message gets when the database's DM shield refuses it (Decision #208). */
export const DM_SHIELDED = Object.freeze({ status: 403, message: DM_SHIELD_REFUSAL } as const);

/**
 * The one answer every buy/sell door gives a restricted account, whether the API route's mirror or
 * the database caught it: a 403, the same sentence, and the same reason key.
 */
export const AGE_RESTRICTED = Object.freeze(
	{
		status: 403,
		message: RESTRICTED_REFUSAL,
		reason: AGE_RESTRICTED_REASON,
	} as const,
);
