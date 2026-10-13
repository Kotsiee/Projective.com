import { z } from "zod";

/**
 * The earning gate (Decision #196): `finance.fn_assert_payout_ready` refuses a door that would land a
 * gig or seat a team member for someone who has not both verified their identity (KYC) and set up a
 * verified payout account. The database is the authority; these are the shapes the API and the
 * islands share for its refusal.
 */

// #region Refusal
/** The SQLSTATE the gate raises (shared with the other verification refusals). */
export const PAYOUT_GATE_SQLSTATE = "PK403";

/** The reason key: the database message's prefix and `details.reason` on the envelope. */
export const PAYOUT_NOT_READY_REASON = "payout_not_ready";

/** Where a person fixes it themselves. */
export const PAYOUT_SETUP_HREF = "/settings/verification";

/** The fix link's label. */
export const PAYOUT_SETUP_ACTION = "Verify and set up payouts";

/** The refusal a person gets about themselves, used by the API mirror and as the fallback copy. */
export const PAYOUT_NOT_READY_REFUSAL =
	"Verify your identity and add a payout account before you take on paid work or join a team.";

/**
 * Who has to act: `self` (the caller — offer the fix link), `other` (the freelancer being seated) or
 * `team` (other shareholders of the team being seated). The database's HINT.
 */
export const PayoutGateActor = z.enum(["self", "other", "team"]);
export type PayoutGateActor = z.infer<typeof PayoutGateActor>;

/** `details` of a payout-not-ready refusal. `members` lists unready `@handles` for a team lead only. */
export const PayoutGateDetailsSchema = z.object({
	reason: z.literal(PAYOUT_NOT_READY_REASON),
	actor: PayoutGateActor,
	href: z.string().nullable(),
	members: z.string().nullable(),
});
export type PayoutGateDetails = z.infer<typeof PayoutGateDetailsSchema>;

/** Read a refusal's `details` as the gate's, or `null` when it is any other refusal. */
export function readPayoutGateDetails(details: unknown): PayoutGateDetails | null {
	const parsed = PayoutGateDetailsSchema.safeParse(details);
	return parsed.success ? parsed.data : null;
}
// #endregion

// #region Dev override
/**
 * The Dev Context Switcher's override of the viewer's own readiness: `not_ready` makes the API routes'
 * mirror refuse as the database would. Absent = no override (the database decides). There is no
 * "ready" override: readiness is a database fact the app cannot grant. Honoured in development only.
 */
export type PayoutOverride = "not_ready";

/** The cookie that carries {@link PayoutOverride}. */
export const PAYOUT_OVERRIDE_COOKIE = "pj.dev.payout";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parsePayoutOverride(raw: string | null | undefined): PayoutOverride | null {
	return raw?.trim() === "not_ready" ? "not_ready" : null;
}
// #endregion
