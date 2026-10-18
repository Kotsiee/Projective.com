import { assert, assertEquals } from "@std/assert";
import type { CheckoutBlocker, CheckoutSpendRequest, MoneyView } from "@projective/types/finance";
import {
	type BusinessGateInput,
	businessGateOf,
	type BusinessGateView,
	gatedSentence,
	type GateSession,
	gateTakesCommit,
	ownedByGate,
	refusalLines,
} from "./business-gate.ts";

/**
 * The business checkout gate (BP2, Decision #243): one sentence from the refusal map and one way
 * forward per refusal, in the order the database refuses — and never a link to `/spend`, which is
 * where the checkout used to send a needs-approval order and where nothing could redeem it.
 */

// #region Fixtures
const BUSINESS_ID = "edb582e0-25d2-48a3-a0db-4a96f1d1a8d1";
const BASKET = "55ed9bd6-ec5d-4937-a473-6140d634d1e9";
const RETURN = `/checkout/payment?basket=${BASKET}&owner=business%3A${BUSINESS_ID}`;

function usd(minor: number): MoneyView {
	return { minor, currency: "USD", display: `$${(minor / 100).toFixed(2)}`, origin: null };
}

const TOTAL = usd(2400);

function session(
	patch: Partial<GateSession> = {},
	limit: Partial<GateSession["spendLimit"]> = {},
): GateSession {
	return {
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
		blockers: [],
		businessAccount: {
			approvers: ["Priya Raman"],
			canAddFunds: true,
			canStartKyb: false,
			canManageMembers: false,
			kybStatus: "verified",
		},
		spendLimit: {
			applies: true,
			verdict: "needs_approval",
			reason: "At or above the approval threshold.",
			cap: usd(2_500_000),
			spent: usd(800_000),
			remaining: usd(1_700_000),
			periodLabel: "this month",
			gate: "needs_approval",
			request: null,
			requestRef: { refTable: "baskets", refId: BASKET },
			approved: false,
			...limit,
		},
		...patch,
	};
}

function request(
	state: CheckoutSpendRequest["state"],
	patch: Partial<CheckoutSpendRequest> = {},
): CheckoutSpendRequest {
	return {
		id: "c0ffee00-0000-4000-8000-000000000001",
		state,
		amount: TOTAL,
		covers: true,
		expiresLabel: "Expires 24 Oct",
		decidedBy: state === "pending" ? null : "Priya Raman",
		...patch,
	};
}

function gate(s: GateSession, more: Partial<BusinessGateInput> = {}): BusinessGateView | null {
	return businessGateOf({
		session: s,
		provider: "wallet",
		lastResult: null,
		returnHref: RETURN,
		...more,
	});
}

function hrefs(view: BusinessGateView | null): string[] {
	const action = view?.action;
	return action && "href" in action ? [action.href] : [];
}

const SPEND_BLOCKER: CheckoutBlocker = {
	code: "spend_limit",
	message: "At or above the approval threshold.",
	itemId: null,
	approvalRef: { refTable: "baskets", refId: BASKET },
	gate: "needs_approval",
};
// #endregion

Deno.test("no gate for a personal, team or non-member checkout", () => {
	const base = session();
	assertEquals(gate({ ...base, owner: { ...base.owner, ownerType: "user" } }), null);
	assertEquals(gate({ ...base, owner: { ...base.owner, ownerType: "team" } }), null);
	assertEquals(gate({ ...base, businessAccount: null }), null);
});

Deno.test("needs_approval: names the approver and offers Request approval — never /spend", () => {
	const view = gate(session());
	assert(view);
	assertEquals(view.kind, "needs_approval");
	assertEquals(view.sentence, "This order needs approval from Priya Raman.");
	assertEquals(view.action, { type: "request", label: "Request approval" });
	assertEquals(view.ask, null);
	assert(!JSON.stringify(view).includes("/spend"), "the gate links to /spend");
});

Deno.test("no other approver: the ask, and no request nobody could decide", () => {
	const view = gate(
		session({
			businessAccount: {
				approvers: [],
				canAddFunds: true,
				canStartKyb: true,
				canManageMembers: false,
				kybStatus: "verified",
			},
		}),
	);
	assertEquals(view?.action, null);
	assertEquals(
		view?.ask,
		"Nobody else at Helia Finance can approve spending yet. Ask the owner to add an approver.",
	);
});

Deno.test("no other approver and the reader is the owner: where to add one, not 'ask the owner'", () => {
	const view = gate(
		session({
			businessAccount: {
				approvers: [],
				canAddFunds: true,
				canStartKyb: true,
				canManageMembers: true,
				kybStatus: "verified",
			},
		}),
	);
	assertEquals(view?.action, null);
	assertEquals(
		view?.ask,
		"Nobody else at Helia Finance can approve spending yet. Give a member approval rights in Members.",
	);
});

Deno.test("a request left pending for an order that no longer needs approval shows nothing", () => {
	const trimmed = session({}, {
		verdict: "allowed",
		gate: null,
		reason: null,
		requestRef: null,
		request: request("pending", { amount: usd(600_000) }),
	});
	assertEquals(gate(trimmed), null);
	const unspent = session({}, {
		verdict: "allowed",
		gate: null,
		reason: null,
		requestRef: null,
		approved: false,
		request: request("approved"),
	});
	assertEquals(gate(unspent), null, "an approval this order will not spend is not announced");
});

Deno.test("over_limit: the remaining envelope when the cap is what the order outruns", () => {
	const capped = gate(session({}, { gate: "over_limit", remaining: usd(1200) }));
	assertEquals(capped?.kind, "over_limit");
	assertEquals(
		capped?.sentence,
		"This order is over your spending limit. You have $12.00 left this month.",
	);
	assertEquals(capped?.action?.type, "request");
	const perOrder = gate(session({}, { gate: "over_limit" }));
	assertEquals(perOrder?.sentence, "This order is over your spending limit at Helia Finance.");
});

Deno.test("pending: waiting, the amount and the expiry, Check again — no second request", () => {
	const view = gate(session({}, { request: request("pending") }));
	assertEquals(view?.kind, "pending");
	assertEquals(view?.sentence, "Waiting for approval from Priya Raman.");
	assertEquals(view?.meta, [{ text: "$24.00", tabular: true }, "Expires 24 Oct"]);
	assertEquals(view?.action, { type: "check_again", label: "Check again" });
});

Deno.test("approved and covering: an informational line, Pay is the commit", () => {
	const view = gate(
		session({}, { verdict: "allowed", gate: null, approved: true, request: request("approved") }),
	);
	assertEquals(view?.kind, "approved");
	assertEquals(view?.sentence, "Approved by Priya Raman. Placing this order uses the approval.");
	assertEquals(view?.action, null);
});

Deno.test("declined, expired or outgrown: request again, saying what became of the last one", () => {
	const declined = gate(session({}, { request: request("declined") }));
	assertEquals(declined?.action?.type, "request");
	assertEquals(declined?.meta, ["Priya Raman declined your last request."]);
	const expired = gate(session({}, { request: request("expired") }));
	assertEquals(expired?.meta, ["Your last request expired before it was used."]);
	const outgrown = gate(
		session({ charge: usd(4800) }, { request: request("approved", { covers: false }) }),
	);
	assertEquals(outgrown?.meta, ["The approval covers $24.00, but this order is now $48.00."]);
});

Deno.test("a refused Pay's gate is used when the pre-flight had none (a race the read could not see)", () => {
	const s = session({}, { verdict: "allowed", gate: null, reason: null, requestRef: null });
	assertEquals(gate(s), null);
	const view = gate(s, { lastResult: { status: "failed", blockers: [SPEND_BLOCKER] } });
	assertEquals(view?.kind, "needs_approval");
	assertEquals(view?.action?.type, "request");
});

Deno.test("kyb_required: the Verification module for a startKyb holder, the ask for everyone else", () => {
	const account = {
		approvers: ["Priya Raman"],
		canAddFunds: true,
		canStartKyb: true,
		canManageMembers: false,
		kybStatus: "pending" as const,
	};
	const holder = gate(
		session({ businessAccount: account }, { gate: "kyb_required", verdict: "blocked" }),
	);
	assertEquals(holder?.kind, "kyb_required");
	assertEquals(holder?.action, {
		type: "verify",
		href: "/businesses/heliafinance/verification",
		label: "See verification",
	});
	assertEquals(
		holder?.sentence,
		"Helia Finance's verification is still in review. You can pay once it clears.",
	);
	const member = gate(
		session({ businessAccount: { ...account, canStartKyb: false, kybStatus: "unverified" } }),
	);
	assertEquals(member?.action, null);
	assertEquals(member?.ask, "Ask the owner to verify the business.");
});

Deno.test("pool short: tier-1 Add money into the business wallet's top-up, returning here", () => {
	const short = session({ wallet: { available: usd(1000), shortfall: usd(1400), covers: false } });
	const view = gate(short);
	assertEquals(view?.kind, "pool_short");
	assertEquals(view?.sentence, "Helia Finance's wallet is $14.00 short for this order.");
	assert(view?.action?.type === "add_money");
	const url = new URL(view.action.href, "https://projective.test");
	assertEquals(url.pathname, "/wallet");
	assertEquals(url.searchParams.get("w"), `business:${BUSINESS_ID}`);
	assertEquals(url.searchParams.get("do"), "top_up");
	assertEquals(url.searchParams.get("back"), RETURN);
	const cannot = gate({
		...short,
		businessAccount: { ...short.businessAccount!, canAddFunds: false },
	});
	assertEquals(cannot?.action, null);
	assertEquals(cannot?.ask, "Ask someone who can add money to top up the business wallet.");
	// A business card pays without the pool.
	assertEquals(gate(short, { provider: "card" })?.kind, "needs_approval");
});

Deno.test("refusal order: not active, then KYB, then purchase, then the pool, then the spend gate", () => {
	const blocker = (gate: CheckoutBlocker["gate"]): CheckoutBlocker => ({
		code: "not_authorised",
		message: "x",
		itemId: null,
		gate,
	});
	const short = { wallet: { available: usd(0), shortfall: usd(2400), covers: false } };
	assertEquals(
		gate(session({ ...short, blockers: [blocker("purchase"), blocker("business_not_active")] }))
			?.kind,
		"business_not_active",
	);
	assertEquals(
		gate(session({ ...short, blockers: [blocker("purchase"), blocker("kyb_required")] }))?.kind,
		"kyb_required",
	);
	assertEquals(gate(session({ ...short, blockers: [blocker("purchase")] }))?.kind, "purchase");
	assertEquals(gate(session(short))?.kind, "pool_short");
});

Deno.test("no href the gate can produce points at /spend", () => {
	const states: GateSession[] = [
		session(),
		session({}, { gate: "over_limit" }),
		session({}, { request: request("pending") }),
		session({}, { request: request("declined") }),
		session({ wallet: { available: usd(0), shortfall: usd(2400), covers: false } }),
		session({
			businessAccount: {
				approvers: [],
				canAddFunds: true,
				canStartKyb: true,
				canManageMembers: false,
				kybStatus: "unverified",
			},
		}),
	];
	for (const s of states) {
		for (const href of hrefs(gate(s))) assert(!href.includes("/spend"), href);
	}
});

Deno.test("ownedByGate + gatedSentence: one refusal, one wording", () => {
	const s = session({ blockers: [SPEND_BLOCKER] });
	const view = gate(s);
	assert(ownedByGate(view, SPEND_BLOCKER));
	assert(!ownedByGate(null, SPEND_BLOCKER));
	assert(!ownedByGate(view, { code: "missing_email", message: "x", itemId: "line" }));
	assertEquals(gatedSentence(SPEND_BLOCKER, s), "This order needs approval from Priya Raman.");
	const pending = session({}, { request: request("pending") });
	assertEquals(gatedSentence(SPEND_BLOCKER, pending), "Waiting for approval from Priya Raman.");
	const team = session();
	assertEquals(gatedSentence({ ...SPEND_BLOCKER, gate: undefined }, team), SPEND_BLOCKER.message);
	const short = session({ wallet: { available: usd(0), shortfall: usd(2400), covers: false } });
	assert(ownedByGate(gate(short), { code: "no_provider", message: "x", itemId: null }));
	assert(!ownedByGate(gate(short), { code: "no_provider", message: "x", itemId: "line-1" }));
});

Deno.test("refusalLines: a gated refusal is said once — the map's headline, not repeated below", () => {
	const raw: CheckoutBlocker = {
		...SPEND_BLOCKER,
		message: "This spend needs an approval before it can be made",
	};
	const email: CheckoutBlocker = { code: "missing_email", message: "Add an email.", itemId: null };
	const refused = {
		status: "failed" as const,
		message: raw.message,
		blockers: [raw, email],
	};
	const lines = refusalLines(refused, session());
	assertEquals(lines.headline, "This order needs approval from Priya Raman.");
	assertEquals(lines.reasons.map((r) => r.sentence), ["Add an email."]);
	assert(!lines.reasons.some((r) => r.sentence === lines.headline));

	const plain = refusalLines({ ...refused, blockers: [email] }, session());
	assertEquals(plain.headline, raw.message);
	assertEquals(plain.reasons.length, 1);

	const personal = session();
	const user = { ...personal, owner: { ...personal.owner, ownerType: "user" as const } };
	assertEquals(refusalLines(refused, user).headline, raw.message);
	assertEquals(refusalLines(refused, null).reasons.map((r) => r.sentence), [
		raw.message,
		"Add an email.",
	]);
});

Deno.test("gateTakesCommit: only a filled way forward takes Buy Now out of the region", () => {
	assert(gateTakesCommit(gate(session())));
	assert(
		gateTakesCommit(
			gate(session({ wallet: { available: usd(0), shortfall: usd(2400), covers: false } })),
		),
	);
	assert(!gateTakesCommit(gate(session({}, { request: request("pending") }))));
	assert(
		!gateTakesCommit(
			gate(
				session({}, {
					verdict: "allowed",
					gate: null,
					approved: true,
					request: request("approved"),
				}),
			),
		),
	);
	assert(!gateTakesCommit(null));
});
