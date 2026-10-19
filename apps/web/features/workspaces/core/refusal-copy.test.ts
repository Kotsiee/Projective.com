import { assert, assertEquals } from "@std/assert";
import { BUSINESS_NOT_ACTIVE_REASON, BusinessAuthorityReason } from "@projective/types/workspace";
import { PLAN_GATE_REASON, SpendGateReason } from "@projective/types/finance";
import {
	approverList,
	BUSINESS_REFUSAL_CODES,
	BUSINESS_REFUSAL_COPY,
	type BusinessRefusalContext,
	isBusinessRefusalCode,
	PLANS_UNAVAILABLE,
	possessive,
	SPEND_REQUEST_COPY,
	type SpendRequestCopyState,
} from "./refusal-copy.ts";

/**
 * The business refusal map (BU6 step 4, Decision #243) words every code the database raises for a
 * business, in plain sentences, whether or not the caller can name the business, its approvers or
 * the figures — a sentence never prints a gap, a raw code or a placeholder.
 */

// #region Fixtures
const EMPTY: BusinessRefusalContext = {};
const FULL: BusinessRefusalContext = {
	business: "Helia Finance",
	approvers: ["Priya Raman", "Hannah Cole"],
	remaining: "$1,700.00",
	period: "this month",
	shortfall: "$120.00",
	kybStatus: "pending",
};
const CONTEXTS: readonly BusinessRefusalContext[] = [
	EMPTY,
	FULL,
	{ ...FULL, kybStatus: "unverified", remaining: null },
	{ ...FULL, kybStatus: "rejected", approvers: [] },
	{ business: "Atlas Labs", kybStatus: "expired" },
	{ business: "Atlas Labs", approvers: [], managesMembers: true },
	{ managesMembers: true },
	{ business: "Probe Co", businessStatus: "draft" },
	{ businessStatus: "archived" },
	{ business: "Probe Co", businessStatus: "archived", ownsBusiness: true },
	{ ownsBusiness: true },
];

function assertPlain(text: string, where: string): void {
	assert(text.trim().length > 0, `${where}: empty`);
	assert(/[.]$/.test(text), `${where}: "${text}" does not end in a full stop`);
	assert(text.length <= 200, `${where}: ${text.length} characters`);
	for (const leak of ["undefined", "null", "_", "{", "}", "  "]) {
		assert(!text.includes(leak), `${where}: "${text}" contains ${JSON.stringify(leak)}`);
	}
}
// #endregion

Deno.test("every code the database raises for a business is a key of the map", () => {
	const expected = [
		...BusinessAuthorityReason.options,
		...SpendGateReason.options,
		BUSINESS_NOT_ACTIVE_REASON,
		PLAN_GATE_REASON,
	];
	for (const code of expected) {
		assert(isBusinessRefusalCode(code), `${code} is not worded`);
		assert(code in BUSINESS_REFUSAL_COPY, `${code} has no copy`);
	}
	assertEquals(Object.keys(BUSINESS_REFUSAL_COPY).sort(), [...BUSINESS_REFUSAL_CODES].sort());
	assert(!isBusinessRefusalCode("spend"));
});

Deno.test("every code reads as plain sentences in every context", () => {
	for (const code of BUSINESS_REFUSAL_CODES) {
		const copy = BUSINESS_REFUSAL_COPY[code];
		for (const [i, ctx] of CONTEXTS.entries()) {
			assertPlain(copy.sentence(ctx), `${code}.sentence #${i}`);
			assertPlain(copy.ask(ctx), `${code}.ask #${i}`);
			if (copy.action) {
				const label = copy.action(ctx);
				assert(label.trim().length > 0 && label.length <= 40, `${code}.action #${i}: "${label}"`);
				assert(!/[.]$/.test(label), `${code}.action #${i} is a sentence, not a label`);
			}
		}
	}
});

Deno.test("the sentences name what the caller knows", () => {
	assertEquals(
		BUSINESS_REFUSAL_COPY.needs_approval.sentence(FULL),
		"This order needs approval from Priya Raman or Hannah Cole.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.over_limit.sentence(FULL),
		"This order is over your spending limit. You have $1,700.00 left this month.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.sentence({ business: "Atlas Labs", kybStatus: "pending" }),
		"Atlas Labs' verification is still in review. You can pay once it clears.",
	);
	// An approver is told what waits for THEM — deciding, not paying (Decision #246).
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.sentence({
			business: "Atlas Labs",
			kybStatus: "pending",
			deciding: true,
		}),
		"Atlas Labs' verification is still in review. You can decide spend requests once it clears.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.sentence({ business: "Atlas Labs", deciding: true }),
		"Atlas Labs needs to be verified before spend requests can be decided.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.sentence({ kybStatus: "rejected" }),
		"This business's verification needs attention before its wallet can pay for anything.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.action?.({ kybStatus: "pending" }),
		"See verification",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.action?.({ business: "Helia Finance" }),
		"Verify Helia Finance",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.kyb_required.ask(EMPTY),
		"Ask the owner to verify the business.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.pool_short.sentence(FULL),
		"Helia Finance's wallet is $120.00 short for this order.",
	);
	assertEquals(BUSINESS_REFUSAL_COPY.pool_short.action?.(FULL), "Add money");
	assertEquals(BUSINESS_REFUSAL_COPY.needs_approval.action?.(EMPTY), "Request approval");
	assertEquals(BUSINESS_REFUSAL_COPY.over_limit.action?.(EMPTY), "Request approval");
});

Deno.test("no other approver: the owner is told where to add one, never to ask the owner", () => {
	for (const code of ["needs_approval", "over_limit"] as const) {
		assertEquals(
			BUSINESS_REFUSAL_COPY[code].ask({ business: "Atlas Labs", approvers: [] }),
			"Nobody else at Atlas Labs can approve spending yet. Ask the owner to add an approver.",
		);
		const owner = BUSINESS_REFUSAL_COPY[code].ask({
			business: "Atlas Labs",
			approvers: [],
			managesMembers: true,
		});
		assertEquals(
			owner,
			"Nobody else at Atlas Labs can approve spending yet. Give a member approval rights in Members.",
		);
		assert(!owner.includes("Ask the owner"));
	}
});

Deno.test("no ask sends a member to a surface that cannot act on it (BU6, Decision #248)", () => {
	// Settings cannot publish or restore a business — the Overview publishes, the roster restores.
	for (const code of BUSINESS_REFUSAL_CODES) {
		for (const [i, ctx] of CONTEXTS.entries()) {
			const ask = BUSINESS_REFUSAL_COPY[code].ask(ctx);
			assert(!/settings/i.test(ask), `${code}.ask #${i}: "${ask}" names settings`);
		}
	}
	assertEquals(
		BUSINESS_REFUSAL_COPY.business_not_active.ask(EMPTY),
		"Ask the owner to publish or restore it.",
	);
	assertEquals(
		BUSINESS_REFUSAL_COPY.business_not_active.sentence({ business: "Probe Co" }),
		"Probe Co isn't active, so it can't buy, hire or pay yet.",
	);
});

Deno.test("business_not_active asks for the one act the business's status needs, where it is known", () => {
	const ask = BUSINESS_REFUSAL_COPY.business_not_active.ask;
	// A draft is published, never restored; an archived business is restored, never published.
	assertEquals(
		ask({ business: "Probe Co", businessStatus: "draft" }),
		"Ask the owner to publish it.",
	);
	assertEquals(
		ask({ business: "Probe Co", businessStatus: "archived" }),
		"Ask the owner to restore it.",
	);
	// Unknown (the checkout reads no status) or anything else: both acts.
	for (const businessStatus of [undefined, null, "active"]) {
		assertEquals(ask({ businessStatus }), "Ask the owner to publish or restore it.");
	}
});

Deno.test("business_not_active tells the owner the act itself, never to ask the owner (#248 (k))", () => {
	const ask = BUSINESS_REFUSAL_COPY.business_not_active.ask;
	assertEquals(ask({ businessStatus: "draft", ownsBusiness: true }), "Publish it first.");
	assertEquals(ask({ businessStatus: "archived", ownsBusiness: true }), "Restore it first.");
	assertEquals(ask({ ownsBusiness: true }), "Publish or restore it first.");
	for (const businessStatus of [undefined, "draft", "archived"]) {
		assert(!ask({ businessStatus, ownsBusiness: true }).includes("Ask the owner"));
	}
});

Deno.test("approverList: none, one, two, three, and more", () => {
	assertEquals(approverList([]), "");
	assertEquals(approverList(undefined), "");
	assertEquals(approverList(["Priya Raman"]), "Priya Raman");
	assertEquals(approverList(["Priya Raman", "Hannah Cole"]), "Priya Raman or Hannah Cole");
	assertEquals(approverList(["A", "B", "C"]), "A, B or C");
	assertEquals(approverList(["A", "B", "C", "D", "E"]), "A, B or 3 others");
});

Deno.test("possessive: no doubled s", () => {
	assertEquals(possessive("Helia Finance"), "Helia Finance's");
	assertEquals(possessive("Atlas Labs"), "Atlas Labs'");
});

Deno.test("every spend-request state reads as a plain sentence", () => {
	const states: SpendRequestCopyState[] = [
		"pending",
		"approved",
		"approvedShort",
		"declined",
		"expired",
	];
	for (const state of states) {
		for (
			const ctx of [
				{},
				{ approvers: ["Priya Raman"], decidedBy: "Priya Raman", amount: "$24.00", total: "$48.00" },
			]
		) {
			assertPlain(SPEND_REQUEST_COPY[state](ctx), `request.${state}`);
		}
	}
	assertEquals(
		SPEND_REQUEST_COPY.pending({ approvers: ["Priya Raman"] }),
		"Waiting for approval from Priya Raman.",
	);
	assertEquals(
		SPEND_REQUEST_COPY.approved({ decidedBy: "Priya Raman" }),
		"Approved by Priya Raman. Placing this order uses the approval.",
	);
});

Deno.test("entitlement: the manager cap names the plan's ceiling and who counts (BU7)", () => {
	const copy = BUSINESS_REFUSAL_COPY.entitlement;
	assertEquals(
		copy.sentence({ business: "Helia Finance", entitlement: "business_managers", limit: 2 }),
		"Helia Finance's plan allows 2 managers — admins and roles that manage projects — and they're all taken or offered. More are part of Business Pro.",
	);
	assertEquals(
		copy.sentence({ business: "Atlas Labs", entitlement: "business_managers", limit: 1 }),
		"Atlas Labs' plan allows 1 manager — admins and roles that manage projects — and they're all taken or offered. More are part of Business Pro.",
	);
	assertEquals(
		copy.sentence({ entitlement: "business_managers" }),
		"This business's plan allows a set number of managers — admins and roles that manage projects — and they're all taken or offered. More are part of Business Pro.",
	);
	for (
		const ctx of [
			{ entitlement: "business_managers" },
			{ entitlement: "business_managers", limit: 15 },
		]
	) {
		assertPlain(copy.sentence(ctx), "entitlement.business_managers");
	}
	// Every other entitlement keeps the general sentence.
	assertEquals(
		copy.sentence({ business: "Helia Finance", entitlement: "pooled_wallet_full" }),
		"That's part of Business Pro, which Helia Finance isn't on.",
	);
	assertEquals(PLANS_UNAVAILABLE, "Changing plans isn't available yet.");
});
