import { assertEquals, assertFalse } from "@std/assert";
import { SPEND_GATE_REFUSAL } from "@projective/types/finance";
import { spendGateReason, spendGateRefusal } from "./spend-gate.ts";

const BASKET = "5f0c7c1e-3a1b-4c2d-9e8f-0a1b2c3d4e5f";
const WALLET = "0bb1d9f1-b826-4bfc-ab8e-26ab3be30616";

const NEEDS_APPROVAL = {
	code: "PA403",
	message: "needs_approval: this spend needs an approval before it can be made",
	details: JSON.stringify({
		wallet_id: WALLET,
		ref_table: "baskets",
		ref_id: BASKET,
		amount_minor: 30000,
		threshold_minor: 30000,
	}),
};

Deno.test("each gate reason is recognised only under its own SQLSTATE", () => {
	assertEquals(spendGateReason(NEEDS_APPROVAL), "needs_approval");
	assertEquals(
		spendGateReason({ code: "PA403", message: "over_limit: this is over your spending limit" }),
		"over_limit",
	);
	assertEquals(
		spendGateReason({
			code: "PK403",
			message: "ERROR:  kyb_required: complete business verification",
		}),
		"kyb_required",
	);
	assertEquals(
		spendGateReason({ code: "PA403", message: "kyb_required: complete business verification" }),
		null,
	);
	assertEquals(
		spendGateReason({ code: "PK403", message: "payout_not_ready: verify your identity" }),
		null,
	);
	assertEquals(spendGateReason({ code: "PK403", message: "missing_permission: purchase" }), null);
	assertEquals(
		spendGateReason({
			code: "PA403",
			message: "This purchase is over your spending limit for this account",
		}),
		null,
	);
	assertEquals(spendGateReason(null), null);
});

Deno.test("a refusal carries the spend an approval request would bind to", () => {
	const refusal = spendGateRefusal(NEEDS_APPROVAL);
	assertEquals(refusal, {
		status: 403,
		message: SPEND_GATE_REFUSAL.needs_approval,
		details: {
			reason: "needs_approval",
			walletId: WALLET,
			refTable: "baskets",
			refId: BASKET,
			amountMinor: 30000,
			thresholdMinor: 30000,
		},
	});
});

Deno.test("a refusal never shows the database's prefix, and tolerates missing or foreign detail", () => {
	const kyb = spendGateRefusal({
		code: "PK403",
		message: "kyb_required: complete business verification",
		details: "not json",
	});
	assertEquals(kyb?.message, SPEND_GATE_REFUSAL.kyb_required);
	assertFalse(kyb?.message.includes("kyb_required"));
	assertEquals(kyb?.details.refTable, null);
	const odd = spendGateRefusal({
		code: "PA403",
		message: "over_limit: over",
		details: JSON.stringify({ ref_table: "wallets", ref_id: "nope", amount_minor: -1 }),
	});
	assertEquals(odd?.details, {
		reason: "over_limit",
		walletId: null,
		refTable: null,
		refId: null,
		amountMinor: null,
		thresholdMinor: null,
	});
	assertEquals(
		spendGateRefusal({
			code: "PF402",
			message: "Needs funding — the client's wallet doesn't hold enough",
		}),
		null,
	);
});
