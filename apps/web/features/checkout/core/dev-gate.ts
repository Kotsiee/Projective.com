import type {
	CheckoutBlocker,
	CheckoutBusinessGate,
	CheckoutSpendRequest,
	SpendLimitBlock,
} from "@projective/types/finance";
import type { DevCheckoutGate } from "@web/utils/dev-seam.ts";
import type { GateSession } from "./business-gate.ts";

/**
 * dev-gate — the Dev Context Switcher's `checkoutGate` axis (Decision #243): each state a business
 * checkout's gate can be in, substituted over a REAL business session, so a reviewer sees it without a
 * threshold, an envelope, a second member's decision or a Stripe KYB update changed in the database.
 *
 * Pure substitutions of the facts the gate reads — the spend position, the business account, the
 * pool's cover and the blockers — so the gate, the blocker list, the rail's "Pay is off…" line and the
 * Buy Now state all follow from the one substituted session. Every figure is still the server's (an
 * amount is the session's own charge). The VIEW only: Pay and Request approval still go to the server,
 * which answers for the real account. Dev builds only — the seam reads `null` in production, and a
 * personal, team or non-member session is returned untouched.
 */

// #region Fixtures
/** The id a substituted request carries; never sent anywhere. */
const DEV_REQUEST_ID = "00000000-0000-4000-8000-00000000d0e5";

/** The business gates a substitution replaces; any other blocker of the real session stays. */
const BUSINESS_GATES: ReadonlySet<CheckoutBusinessGate | undefined> = new Set<
	CheckoutBusinessGate | undefined
>(["kyb_required", "over_limit", "needs_approval", "business_not_active", "purchase"]);

const REASON: Readonly<Record<"needs_approval" | "over_limit", string>> = {
	needs_approval: "At or above the approval threshold.",
	over_limit: "Above your remaining spend limit.",
};
// #endregion

// #region Substitution
/** The real session's blockers that are not business refusals or the spend limit. */
function othersOf(session: GateSession): CheckoutBlocker[] {
	return session.blockers.filter((b) => b.code !== "spend_limit" && !BUSINESS_GATES.has(b.gate));
}

/** A request for this session's charge, in the given state. */
function requestOf(
	session: GateSession,
	state: CheckoutSpendRequest["state"],
): CheckoutSpendRequest {
	return {
		id: DEV_REQUEST_ID,
		state,
		amount: session.charge ?? session.totals.total,
		covers: true,
		expiresLabel: "Expires in 7 days",
		decidedBy: state === "pending" ? null : session.businessAccount?.approvers[0] ?? null,
	};
}

/** The session refused by the spend gate under `gate`, optionally with the member's request. */
function refusedBy<T extends GateSession>(
	session: T,
	gate: "needs_approval" | "over_limit",
	request: CheckoutSpendRequest | null,
): T {
	const reason = request?.state === "pending"
		? "Waiting for an approver's decision."
		: REASON[gate];
	const spendLimit: SpendLimitBlock = {
		...session.spendLimit,
		applies: true,
		verdict: "needs_approval",
		reason,
		gate,
		request,
		approved: false,
	};
	return {
		...session,
		wallet: { ...session.wallet, covers: true },
		spendLimit,
		blockers: [
			...othersOf(session),
			{ code: "spend_limit", message: reason, itemId: null, gate },
		],
	};
}

/**
 * The session as the switcher's `checkoutGate` state shows it; the session itself for `auto`, an
 * absent seam, and anything but a member buying for a business.
 */
export function devGateSession<T extends GateSession>(
	session: T,
	gate: DevCheckoutGate | null | undefined,
): T {
	const account = session.businessAccount;
	if (!gate || gate === "auto" || session.owner.ownerType !== "business" || account === null) {
		return session;
	}
	switch (gate) {
		case "needs_approval":
		case "over_limit":
			return refusedBy(session, gate, null);
		case "pending":
			return refusedBy(session, "needs_approval", requestOf(session, "pending"));
		case "no_approver":
			return {
				...refusedBy(session, "needs_approval", null),
				businessAccount: { ...account, approvers: [] },
			};
		case "approved":
			return {
				...session,
				wallet: { ...session.wallet, covers: true },
				spendLimit: {
					...session.spendLimit,
					applies: true,
					verdict: "allowed",
					reason: null,
					gate: null,
					request: requestOf(session, "approved"),
					requestRef: null,
					approved: true,
				},
				blockers: othersOf(session),
			};
		case "pool_short":
			return {
				...session,
				wallet: {
					...session.wallet,
					covers: false,
					// The whole order, as if the pool were empty — a server figure, never one computed here.
					shortfall: session.wallet.covers ? session.totals.total : session.wallet.shortfall,
				},
			};
		case "kyb_required":
			return {
				...session,
				businessAccount: { ...account, kybStatus: "unverified" },
				spendLimit: {
					...session.spendLimit,
					applies: true,
					verdict: "blocked",
					reason: "The pooled wallet is locked until verification clears.",
					gate: "kyb_required",
					request: null,
					approved: false,
				},
				blockers: [
					...othersOf(session),
					{
						code: "verification_required",
						message: "Complete business verification (KYB) to pay from this account.",
						itemId: null,
						gate: "kyb_required",
					},
				],
			};
	}
}
// #endregion
