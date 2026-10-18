import { assert, assertEquals } from "@std/assert";
import { ApprovalStatus, SpendApprovalSchema, SpendRefTable } from "./vault.ts";
import { SpendRequestInputSchema, WalletActionRequestSchema } from "./wallet.ts";
import { CheckoutBlockerSchema, SpendLimitBlockSchema } from "./checkout.ts";

/**
 * A spend approval binds to what it approves (BUSINESSES_AUDIT BF20 / §4.3): the request contract
 * refuses a request with no ref, or a ref outside the set `finance.spend_approvals.ref_table` allows,
 * so the API can never file the unbound request the database would refuse.
 */

const BASKET = "3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b";
const WALLET = "0bb1d9f1-b826-4bfc-ab8e-26ab3be30616";
const USER = "35ce4987-15b3-4c38-a438-2bb9c35df15a";

const request = {
	scope: "business",
	contextId: "edb582e0-25d2-48a3-a0db-4a96f1d1a8d1",
	refTable: "baskets",
	refId: BASKET,
	amountMinor: 60000,
	currency: "USD",
	reason: "Annual design tooling",
};

// #region Request contract
Deno.test("SpendRequestInputSchema: a request bound to a basket parses", () => {
	assert(SpendRequestInputSchema.safeParse(request).success);
});

Deno.test("SpendRequestInputSchema: a request with no ref is refused", () => {
	const { refTable: _t, refId: _i, ...unbound } = request;
	const parsed = SpendRequestInputSchema.safeParse(unbound);
	assert(!parsed.success);
	const paths = parsed.error.issues.map((issue) => issue.path.join("."));
	assert(paths.includes("refTable"));
	assert(paths.includes("refId"));
});

Deno.test("SpendRequestInputSchema: a ref outside the allowed set is refused", () => {
	for (
		const refTable of ["orders", "basket_items", "projects", "wallets", "stage_revision_requests"]
	) {
		assert(!SpendRequestInputSchema.safeParse({ ...request, refTable }).success, refTable);
	}
});

Deno.test("ApprovalStatus mirrors finance.approval_status, withdrawn included (Decision #246)", () => {
	const sql = Deno.readTextFileSync(
		new URL("../../../supabase/migrations/00000004_enums_domains.sql", import.meta.url),
	);
	const match = /CREATE TYPE finance\.approval_status AS ENUM \(([^)]*)\)/.exec(sql);
	assert(match, "finance.approval_status is no longer declared");
	const declared = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
	assertEquals(ApprovalStatus.options, declared);
	assert(ApprovalStatus.options.includes("withdrawn"));
});

Deno.test("SpendRefTable mirrors the spend_approvals ref_table CHECK", () => {
	assertEquals(SpendRefTable.options, [
		"baskets",
		"tickets",
		"project_stages",
		"revisions",
		"invoices",
		"transfers",
	]);
});

Deno.test("WalletActionRequestSchema: request_spend carries the ref through", () => {
	const parsed = WalletActionRequestSchema.safeParse({ action: "request_spend", ...request });
	assert(parsed.success);
	assertEquals(parsed.data.action === "request_spend" && parsed.data.refId, BASKET);
});
// #endregion

// #region Row and checkout projections
Deno.test("SpendApprovalSchema: a spent row records what spent it", () => {
	const row = {
		id: "8ea0bfc1-4e4b-4adc-ac60-07879e1f86aa",
		walletId: WALLET,
		requestedBy: USER,
		amountCents: 60000,
		currency: "USD",
		reason: "Annual design tooling",
		refTable: "baskets",
		refId: BASKET,
		status: "approved",
		approverUserId: "de29f2ce-0f36-4db5-a417-4edc88cedf83",
		decidedAt: "2026-10-17T10:00:00.000Z",
		expiresAt: "2026-10-24T10:00:00.000Z",
		consumedAt: "2026-10-17T11:00:00.000Z",
		consumedRefTable: "baskets",
		consumedRefId: BASKET,
		createdAt: "2026-10-17T09:00:00.000Z",
	};
	assert(SpendApprovalSchema.safeParse(row).success);
	assert(!SpendApprovalSchema.safeParse({ ...row, refId: null }).success);
});

Deno.test("CheckoutBlockerSchema: a spend_limit blocker may carry the ref to file against", () => {
	const parsed = CheckoutBlockerSchema.safeParse({
		code: "spend_limit",
		message: "This spend needs an approval before it can be made",
		itemId: null,
		approvalRef: { refTable: "baskets", refId: BASKET },
	});
	assert(parsed.success);
	assertEquals(parsed.data.approvalRef?.refId, BASKET);
});

Deno.test("SpendLimitBlockSchema: the request binding defaults to none", () => {
	const zero = { minor: 0, currency: "USD", display: "$0.00", origin: null };
	const parsed = SpendLimitBlockSchema.parse({
		applies: true,
		verdict: "allowed",
		reason: null,
		cap: null,
		spent: zero,
		remaining: null,
		periodLabel: null,
	});
	assertEquals(parsed.requestRef, null);
	assertEquals(parsed.approved, false);
});
// #endregion
