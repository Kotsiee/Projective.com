import { assert, assertEquals } from "@std/assert";
import { AGE_RESTRICTED } from "../../core/age-gate.ts";
import {
	authorityBlocker,
	BLOCKER_FOR_SQLSTATE,
	businessNotActiveBlocker,
	orderRefusal,
	refusalBlocker,
} from "./checkout-refusal.ts";

/**
 * How a database refusal at Pay becomes a checkout blocker (Decision #243). The business ones carry
 * their `gate`, so the surface words them from the one business refusal map and offers the way past:
 * a `needs_approval` / `over_limit` refusal names the basket a request binds to, a KYB refusal the
 * verification path, and a draft or archived business's `55000 business_not_active:` is a refusal
 * the buyer reads rather than a 503 (Decision #236 flag (e)).
 */

// #region Fixtures
const BASKET = "55ed9bd6-ec5d-4937-a473-6140d634d1e9";
const OTHER = "0bb1d9f1-b826-4bfc-ab8e-26ab3be30616";
const WALLET = "9bc97e73-5ac6-487a-a2a7-1d156c8ac784";

function detail(extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		wallet_id: WALLET,
		ref_table: "baskets",
		ref_id: OTHER,
		amount_minor: 2400,
		threshold_minor: 1000,
		...extra,
	});
}
// #endregion

Deno.test("55000 business_not_active: a refusal with its gate, never a throw", () => {
	const blocker = refusalBlocker(
		{ code: "55000", message: "business_not_active: publish the business first", details: null },
		BASKET,
		"business",
	);
	assert(blocker, "a draft business's refusal fell through to a 503");
	assertEquals(blocker.code, "not_authorised");
	assertEquals(blocker.gate, "business_not_active");
	assertEquals(blocker.message, "Publish the business first");
});

Deno.test("businessNotActiveBlocker: the card top-up's refusal is the wallet order's gate", () => {
	assertEquals(businessNotActiveBlocker("This business is archived — restore it first."), {
		code: "not_authorised",
		message: "This business is archived — restore it first.",
		itemId: null,
		gate: "business_not_active",
	});
	assertEquals(
		refusalBlocker(
			{
				code: "55000",
				message: "business_not_active: this business is archived — restore it first",
				details: null,
			},
			BASKET,
			"business",
		),
		businessNotActiveBlocker("This business is archived — restore it first"),
	);
});

Deno.test("55000 without the business prefix is still not a checkout refusal", () => {
	assertEquals(
		refusalBlocker({ code: "55000", message: "object in use", details: null }, BASKET, "business"),
		null,
	);
	assertEquals(BLOCKER_FOR_SQLSTATE["55000"], undefined);
});

Deno.test("PA403 needs_approval: a spend_limit blocker bound to the ref the redeemer named", () => {
	const blocker = refusalBlocker(
		{
			code: "PA403",
			message: "needs_approval: this spend needs an approval before it can be made",
			details: detail(),
		},
		BASKET,
		"business",
	);
	assert(blocker);
	assertEquals(blocker.code, "spend_limit");
	assertEquals(blocker.gate, "needs_approval");
	assertEquals(blocker.approvalRef, { refTable: "baskets", refId: OTHER });
	assertEquals(blocker.message, "This spend needs an approval before it can be made");
});

Deno.test("PA403 over_limit: the envelope's gate, falling back to this basket for the ref", () => {
	const blocker = refusalBlocker(
		{
			code: "PA403",
			message: "over_limit: this is over your spending limit for this account",
			details: null,
		},
		BASKET,
		"business",
	);
	assert(blocker);
	assertEquals(blocker.gate, "over_limit");
	assertEquals(blocker.approvalRef, { refTable: "baskets", refId: BASKET });
});

Deno.test("PA403 with no gate prefix (a team) carries no business gate", () => {
	const blocker = refusalBlocker(
		{
			code: "PA403",
			message: "This purchase needs approval before it can be paid for",
			details: null,
		},
		BASKET,
		"team",
	);
	assert(blocker);
	assertEquals(blocker.code, "spend_limit");
	assertEquals(blocker.gate, undefined);
});

Deno.test("PK403 kyb_required: verification_required with the KYB gate", () => {
	const blocker = refusalBlocker(
		{
			code: "PK403",
			message: "kyb_required: complete business verification (KYB) before spending",
			details: null,
		},
		BASKET,
		"business",
	);
	assert(blocker);
	assertEquals(blocker.code, "verification_required");
	assertEquals(blocker.gate, "kyb_required");
	assertEquals(blocker.approvalRef, undefined);
});

Deno.test("PK403 un-prefixed: KYB on a business basket, nothing on a team's", () => {
	const error = {
		code: "PK403",
		message: "Complete business verification (KYB) to pay from this account",
	};
	assertEquals(refusalBlocker(error, BASKET, "business")?.gate, "kyb_required");
	assertEquals(refusalBlocker(error, BASKET, "enterprise")?.gate, undefined);
	assertEquals(refusalBlocker(error, BASKET, "team")?.gate, undefined);
});

Deno.test("PM403 (the age gate) keeps its own sentence and no gate", () => {
	const blocker = orderRefusal(
		"not_authorised",
		{ code: "PM403", message: "age: restricted" },
		BASKET,
		"business",
	);
	assertEquals(blocker.gate, undefined);
	assertEquals(blocker.message, AGE_RESTRICTED.message);
});

Deno.test("an unmapped SQLSTATE is not a refusal (the caller throws, the route answers 503)", () => {
	assertEquals(refusalBlocker({ code: "XX000", message: "boom" }, BASKET, "business"), null);
});

Deno.test("authorityBlocker: the purchasing right is the purchase gate; other rights carry none", () => {
	assertEquals(
		authorityBlocker("purchase", "You need the purchasing permission.").gate,
		"purchase",
	);
	assertEquals(authorityBlocker("purchase", "x").code, "not_authorised");
	assertEquals(authorityBlocker("hire", "x").gate, undefined);
});
