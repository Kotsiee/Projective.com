import { assert, assertEquals } from "@std/assert";
import type { MoneyView } from "@projective/types/finance";
import type { DevCheckoutGate } from "@web/utils/dev-seam.ts";
import { businessGateOf, type GateSession } from "./business-gate.ts";
import { devGateSession } from "./dev-gate.ts";

/**
 * The Dev Context Switcher's checkout gate axis (Decision #243): every state it offers turns a real,
 * unrefused business session into exactly that gate, and leaves every other session alone.
 */

// #region Fixtures
const BUSINESS_ID = "edb582e0-25d2-48a3-a0db-4a96f1d1a8d1";

function usd(minor: number): MoneyView {
	return { minor, currency: "USD", display: `$${(minor / 100).toFixed(2)}`, origin: null };
}

const TOTAL = usd(2400);

/** A business session the database would let pay: nothing refused, nothing pending. */
const CLEAR: GateSession = {
	owner: {
		ownerType: "business",
		ownerId: BUSINESS_ID,
		name: "Helia Finance",
		handle: "heliafinance",
		avatar: null,
		actingIsMember: true,
	},
	wallet: { available: usd(889_700), shortfall: usd(0), covers: true },
	totals: { total: TOTAL } as GateSession["totals"],
	charge: TOTAL,
	blockers: [{ code: "missing_email", message: "Add an email.", itemId: "line-1" }],
	businessAccount: {
		approvers: ["Priya Raman"],
		canAddFunds: true,
		canStartKyb: true,
		canManageMembers: false,
		kybStatus: "verified",
	},
	spendLimit: {
		applies: true,
		verdict: "allowed",
		reason: null,
		cap: null,
		spent: usd(0),
		remaining: null,
		periodLabel: null,
		gate: null,
		request: null,
		requestRef: null,
		approved: false,
	},
};

function kindFor(gate: DevCheckoutGate, session: GateSession = CLEAR): string | null {
	return businessGateOf({
		session: devGateSession(session, gate),
		provider: "wallet",
		lastResult: null,
		returnHref: "/checkout/payment",
	})?.kind ?? null;
}
// #endregion

Deno.test("auto, an absent seam and a non-business session are untouched", () => {
	assertEquals(devGateSession(CLEAR, "auto"), CLEAR);
	assertEquals(devGateSession(CLEAR, undefined), CLEAR);
	assertEquals(devGateSession(CLEAR, null), CLEAR);
	const team = { ...CLEAR, owner: { ...CLEAR.owner, ownerType: "team" as const } };
	assertEquals(devGateSession(team, "pending"), team);
	const visitor = { ...CLEAR, businessAccount: null };
	assertEquals(devGateSession(visitor, "kyb_required"), visitor);
});

Deno.test("every state is the gate it names, on a real unrefused business session", () => {
	assertEquals(kindFor("auto"), null);
	assertEquals(kindFor("needs_approval"), "needs_approval");
	assertEquals(kindFor("over_limit"), "over_limit");
	assertEquals(kindFor("pending"), "pending");
	assertEquals(kindFor("approved"), "approved");
	assertEquals(kindFor("no_approver"), "needs_approval");
	assertEquals(kindFor("pool_short"), "pool_short");
	assertEquals(kindFor("kyb_required"), "kyb_required");
});

Deno.test("refusals refuse Pay and approvals clear it; other blockers stay", () => {
	for (
		const gate of [
			"needs_approval",
			"over_limit",
			"pending",
			"no_approver",
			"kyb_required",
		] as const
	) {
		const s = devGateSession(CLEAR, gate);
		assert(s.blockers.some((b) => b.gate !== undefined), `${gate} refuses nothing`);
		assert(s.blockers.some((b) => b.code === "missing_email"), `${gate} dropped a real blocker`);
	}
	const approved = devGateSession(
		{
			...CLEAR,
			blockers: [...CLEAR.blockers, {
				code: "spend_limit",
				message: "x",
				itemId: null,
				gate: "needs_approval",
			}],
		},
		"approved",
	);
	assertEquals(approved.blockers.map((b) => b.code), ["missing_email"]);
	assertEquals(approved.spendLimit.approved, true);
	assertEquals(devGateSession(CLEAR, "no_approver").businessAccount?.approvers, []);
});

Deno.test("a substituted figure is always one of the session's own", () => {
	const pending = devGateSession(CLEAR, "pending");
	assertEquals(pending.spendLimit.request?.amount, TOTAL);
	const short = devGateSession(CLEAR, "pool_short");
	assertEquals(short.wallet.shortfall, TOTAL);
	assertEquals(short.wallet.covers, false);
});
