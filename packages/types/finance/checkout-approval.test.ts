import { assert, assertEquals } from "@std/assert";
import {
	CheckoutApprovalRequestSchema,
	CheckoutBlockerSchema,
	CheckoutBusinessAccountSchema,
	CheckoutBusinessGate,
	CheckoutSessionContextSchema,
	CheckoutSpendRequestSchema,
	SpendLimitBlockSchema,
} from "./checkout.ts";

/**
 * The checkout's "needs approval" contract (Decision #243): a request is filed bound to the basket
 * with a reason the approver reads, never a client-supplied amount; the spend-limit block names the
 * business gate and the member's latest request instead of a link to `/spend`.
 */

// #region Fixtures
const BASKET = "55ed9bd6-ec5d-4937-a473-6140d634d1e9";
const LINE = "8b1f0c2d-3e4a-4b5c-9d6e-7f8091a2b3c4";
const ZERO = { minor: 0, currency: "USD", display: "$0.00", origin: null };
const LIMIT = {
	applies: true,
	verdict: "needs_approval",
	reason: "At or above the approval threshold.",
	cap: null,
	spent: ZERO,
	remaining: null,
	periodLabel: null,
};
// #endregion

Deno.test("CheckoutApprovalRequestSchema: the reason is trimmed and bound to 1–400 characters", () => {
	const ok = CheckoutApprovalRequestSchema.parse({
		basketId: BASKET,
		itemIds: [LINE],
		reason: "  Lightroom presets for the Q4 campaign  ",
	});
	assertEquals(ok.reason, "Lightroom presets for the Q4 campaign");
	for (const reason of ["", "   ", "x".repeat(401)]) {
		assert(
			!CheckoutApprovalRequestSchema.safeParse({ basketId: BASKET, itemIds: [LINE], reason })
				.success,
			`reason ${JSON.stringify(reason.slice(0, 8))}… accepted`,
		);
	}
	assert(
		CheckoutApprovalRequestSchema.safeParse({
			basketId: BASKET,
			itemIds: [LINE],
			reason: "x".repeat(400),
		}).success,
	);
});

Deno.test("CheckoutApprovalRequestSchema: at least one line, and no amount is taken from the client", () => {
	assert(
		!CheckoutApprovalRequestSchema.safeParse({ basketId: BASKET, itemIds: [], reason: "Q4" })
			.success,
	);
	const parsed = CheckoutApprovalRequestSchema.parse({
		basketId: BASKET,
		itemIds: [LINE],
		reason: "Q4",
		amountMinor: 1,
	});
	assertEquals("amountMinor" in parsed, false);
});

Deno.test("SpendLimitBlockSchema: the gate and the request default to none, and no /spend link is emitted", () => {
	const parsed = SpendLimitBlockSchema.parse({
		...LIMIT,
		requestHref: "/businesses/heliafinance/spend",
	});
	assertEquals(parsed.gate, null);
	assertEquals(parsed.request, null);
	assertEquals("requestHref" in parsed, false);
});

Deno.test("SpendLimitBlockSchema: carries the gate and the member's pending request", () => {
	const parsed = SpendLimitBlockSchema.parse({
		...LIMIT,
		gate: "needs_approval",
		requestRef: { refTable: "baskets", refId: BASKET },
		request: {
			id: "c0ffee00-0000-4000-8000-000000000001",
			state: "pending",
			amount: { minor: 2400, currency: "USD", display: "$24.00", origin: null },
			covers: true,
			expiresLabel: "Expires 24 Oct",
			decidedBy: null,
		},
	});
	assertEquals(parsed.gate, "needs_approval");
	assertEquals(parsed.request?.state, "pending");
	assert(!SpendLimitBlockSchema.safeParse({ ...LIMIT, gate: "purchase" }).success);
});

Deno.test("CheckoutSpendRequestSchema: only the four states the checkout shows", () => {
	const base = {
		id: "c0ffee00-0000-4000-8000-000000000001",
		amount: ZERO,
		covers: false,
		expiresLabel: null,
		decidedBy: "Priya Raman",
	};
	for (const state of ["pending", "approved", "declined", "expired"]) {
		assert(CheckoutSpendRequestSchema.safeParse({ ...base, state }).success, state);
	}
	assert(!CheckoutSpendRequestSchema.safeParse({ ...base, state: "rejected" }).success);
});

Deno.test("CheckoutBlockerSchema: every business gate parses, an unknown one is refused", () => {
	for (const gate of CheckoutBusinessGate.options) {
		const parsed = CheckoutBlockerSchema.parse({
			code: "spend_limit",
			message: "x",
			itemId: null,
			gate,
		});
		assertEquals(parsed.gate, gate);
	}
	assert(
		!CheckoutBlockerSchema.safeParse({
			code: "spend_limit",
			message: "x",
			itemId: null,
			gate: "hire",
		}).success,
	);
	assertEquals(
		CheckoutBlockerSchema.parse({ code: "empty", message: "x", itemId: null }).gate,
		undefined,
	);
});

Deno.test("CheckoutBusinessAccountSchema: approvers are bounded names", () => {
	const account = CheckoutBusinessAccountSchema.parse({
		approvers: ["Priya Raman"],
		canAddFunds: true,
		canStartKyb: false,
		kybStatus: "verified",
	});
	assertEquals(account.approvers, ["Priya Raman"]);
	assertEquals(account.canManageMembers, false, "a reader is not the owner unless told so");
	assert(
		!CheckoutBusinessAccountSchema.safeParse({ ...account, approvers: Array(13).fill("A") })
			.success,
	);
});

Deno.test("CheckoutApprovalRequestSchema: the page's deep-link scope travels with the request", () => {
	const scoped = CheckoutApprovalRequestSchema.parse({
		basketId: BASKET,
		itemIds: [LINE],
		reason: "Q4",
		preselect: { projectId: BASKET, serviceId: null },
	});
	assertEquals(scoped.preselect, { projectId: BASKET, serviceId: null });
	const bare = CheckoutApprovalRequestSchema.parse({
		basketId: BASKET,
		itemIds: [LINE],
		reason: "Q4",
	});
	assertEquals(bare.preselect, undefined);
});

Deno.test("CheckoutSessionContextSchema: businessAccount defaults to null", () => {
	const shape = CheckoutSessionContextSchema.shape.businessAccount;
	assertEquals(shape.parse(undefined), null);
});
