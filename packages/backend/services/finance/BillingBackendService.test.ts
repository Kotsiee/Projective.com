import { assertEquals } from "@std/assert";
import {
	billingRefusal,
	INVOICE_WINDOW,
	invoiceWindow,
	toBillingView,
	toInvoiceRow,
} from "./BillingBackendService.ts";

const NOW = new Date("2026-10-10T12:00:00Z");

const settings = (over: Record<string, unknown> = {}) => ({
	business_id: "00000000-0000-4000-8000-000000000001",
	currency: "gbp",
	invoicing_mode: "intervaled_monthly",
	billing_day: 15,
	kyb_verified: true,
	auto_fund_mode: "from_wallet",
	low_balance_floor_cents: 50000,
	can_manage: true,
	...over,
});

Deno.test("an issued invoice past its due date reads overdue, with what is owed", () => {
	const row = toInvoiceRow({
		id: "00000000-0000-4000-8000-0000000000aa",
		currency: "GBP",
		status: "issued",
		total_cents: 120000,
		amount_due_cents: 30000,
		due_date: "2026-10-07T00:00:00Z",
		billing_period_start: "2026-08-15T00:00:00Z",
		billing_period_end: "2026-09-15T00:00:00Z",
	}, NOW);
	assertEquals([row.status, row.overdue, row.dueLabel, row.amountDueMinor], ["overdue", true, "Overdue 4 days", 30000]);
});

Deno.test("a paid invoice owes nothing, whatever was due", () => {
	const row = toInvoiceRow({
		id: "00000000-0000-4000-8000-0000000000ab",
		currency: "GBP",
		status: "paid",
		total_cents: 120000,
		amount_due_cents: 30000,
		paid_at: "2026-10-02T09:00:00Z",
	}, NOW);
	assertEquals([row.amountDueMinor, row.dueLabel, row.overdue], [0, "Paid Oct 2", false]);
});

Deno.test("the floor warning reads the default-currency balance; monthly terms name the next invoice", () => {
	const view = toBillingView({
		settings: settings(),
		balanceMinor: 49999,
		standing: { owed_minor: 0, limit_minor: 2500000 },
		invoices: [],
		statements: [],
		now: NOW,
	});
	assertEquals(view.belowFloor, true);
	assertEquals(view.currency, "GBP");
	assertEquals(view.nextInvoiceLabel, "Next invoice Oct 15");
	assertEquals(view.onAccount?.limitLabel.includes("25,000.00"), true);

	const perTransaction = toBillingView({
		settings: settings({ invoicing_mode: "per_transaction", low_balance_floor_cents: null }),
		balanceMinor: 0,
		standing: null,
		invoices: [],
		statements: [],
		now: NOW,
	});
	assertEquals([perTransaction.belowFloor, perTransaction.nextInvoiceLabel, perTransaction.onAccount], [false, null, null]);
});

Deno.test("Pay is the database's call: the billing right alone does not offer it", () => {
	const view = (over: Record<string, unknown>) =>
		toBillingView({
			settings: settings(over),
			balanceMinor: 0,
			standing: null,
			invoices: [],
			statements: [],
			now: NOW,
		});
	assertEquals([view({}).canManage, view({}).canPay], [true, false]);
	assertEquals(view({ can_pay: true }).canPay, true);
	assertEquals(view({ can_manage: true, can_pay: null }).canPay, false);
});

// #region The review's figures (BU3, Decision #247)
const DUE_ROW = {
	id: "00000000-0000-4000-8000-0000000000ac",
	currency: "USD",
	status: "issued",
	total_cents: 120000,
	amount_due_cents: 64000,
	due_date: "2026-10-15T00:00:00Z",
	created_at: "2026-09-28T03:00:00Z",
	billing_period_start: "2026-08-28T00:00:00Z",
	billing_period_end: "2026-09-28T00:00:00Z",
};

Deno.test("a wallet that covers the invoice reads covered, with the balance after Pay", () => {
	const row = toInvoiceRow(DUE_ROW, NOW, 887300);
	assertEquals(
		[row.covered, row.walletBalanceLabel, row.balanceAfterLabel, row.shortfallLabel],
		[true, "US$8,873.00", "US$8,233.00", null],
	);
});

Deno.test("a wallet short of the invoice is not covered and names the shortfall", () => {
	const row = toInvoiceRow({ ...DUE_ROW, amount_due_cents: 1000000 }, NOW, 887300);
	assertEquals([row.covered, row.balanceAfterLabel, row.shortfallLabel], [
		false,
		null,
		"US$1,127.00",
	]);
	const empty = toInvoiceRow(DUE_ROW, NOW);
	assertEquals([empty.covered, empty.walletBalanceLabel, empty.shortfallLabel], [
		false,
		"US$0.00",
		"US$640.00",
	]);
});

Deno.test("nothing due is neither covered nor short", () => {
	const row = toInvoiceRow(
		{ ...DUE_ROW, status: "paid", paid_at: "2026-10-02T09:00:00Z" },
		NOW,
		887300,
	);
	assertEquals([row.covered, row.balanceAfterLabel, row.shortfallLabel], [false, null, null]);
});

Deno.test("an invoice reads its issue and due dates on their own", () => {
	const row = toInvoiceRow(DUE_ROW, NOW, 0);
	assertEquals(
		[row.issuedAt, row.issuedLabel, row.dueDateLabel, row.dueLabel],
		["2026-09-28T03:00:00.000Z", "Sep 28", "Oct 15", "Due Oct 15"],
	);
	const bare = toInvoiceRow({ ...DUE_ROW, created_at: null, due_date: null }, NOW, 0);
	assertEquals([bare.issuedAt, bare.issuedLabel, bare.dueDateLabel], [null, "—", "—"]);
});

Deno.test("an invoice in another currency is covered by the wallet in that currency", () => {
	const view = toBillingView({
		settings: settings({ currency: "usd" }),
		balanceMinor: 887300,
		balances: { USD: 887300, EUR: 1000 },
		standing: null,
		invoices: [
			{ ...DUE_ROW, id: "00000000-0000-4000-8000-0000000000ad", currency: "eur" },
			DUE_ROW,
		],
		statements: [],
		now: NOW,
	});
	assertEquals(
		view.invoices.map((r) => [r.currency, r.covered, r.walletBalanceLabel.includes("10.00")]),
		[
			["EUR", false, true],
			["USD", true, false],
		],
	);
});

Deno.test("monthly invoicing is open unless the database says the plan refuses it", () => {
	const view = (over: Record<string, unknown>) =>
		toBillingView({
			settings: settings(over),
			balanceMinor: 0,
			standing: null,
			invoices: [],
			statements: [],
			now: NOW,
		}).planAllowsMonthly;
	assertEquals([
		view({ plan_allows_monthly: true }),
		view({ plan_allows_monthly: false }),
		view({}),
	], [
		true,
		false,
		true,
	]);
});

Deno.test("a business that isn't active is a 409 in the reader's words, not an outage", () => {
	const res = billingRefusal({
		code: "55000",
		message: "business_not_active: publish the business first",
	});
	assertEquals([res.ok, res.status, res.message], [false, 409, "Publish the business first."]);
	// The code rides along, so the screen words it from the business refusal map.
	assertEquals(res.details, { reason: "business_not_active" });
	const bare = billingRefusal({ code: "55000", message: "business_not_active:" });
	assertEquals(bare.message, "This business isn't active.");
	// Any other 55000 keeps its own sentence and names no code — it is not "the business isn't active".
	const other = billingRefusal({
		code: "55000",
		message: "Restore this team before changing its roles",
	});
	assertEquals([other.status, other.message, other.details], [
		409,
		"Restore this team before changing its roles",
		undefined,
	]);
});

Deno.test("the invoice window keeps every payable invoice, however old, beside the newest 36", () => {
	const month = (i: number) => new Date(Date.UTC(2020, i, 1)).toISOString();
	const paid = Array.from({ length: 40 }, (_, i) => ({
		...DUE_ROW,
		id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`,
		status: "paid",
		amount_due_cents: 0,
		billing_period_start: month(i + 2),
	}));
	// Older than every paid one: outside the newest 36, still owed — and read twice (window + payable).
	const owed = {
		...DUE_ROW,
		id: "00000000-0000-4000-8000-0000000000ae",
		billing_period_start: month(0),
	};
	const nothingDue = {
		...owed,
		id: "00000000-0000-4000-8000-0000000000af",
		billing_period_start: month(1),
		amount_due_cents: 0,
	};
	const kept = invoiceWindow([...[...paid].reverse(), nothingDue, owed, owed]);
	assertEquals(kept.length, INVOICE_WINDOW + 1);
	assertEquals(kept.at(-1)?.id, owed.id);
	assertEquals(kept[0].billing_period_start, month(41));
	const view = toBillingView({
		settings: settings({ currency: "usd" }),
		balanceMinor: 887300,
		standing: null,
		invoices: [...paid, owed],
		statements: [],
		now: NOW,
	});
	assertEquals([
		view.invoices.length,
		view.invoices.at(-1)?.id,
		view.invoices.at(-1)?.amountDueMinor,
	], [
		37,
		owed.id,
		64000,
	]);
});

Deno.test("an unverified business's Pay is a 403 naming kyb_required; another 403 names nothing", () => {
	const res = billingRefusal({
		code: "PK403",
		message: "kyb_required: complete business verification (KYB) before paying from this account",
	});
	assertEquals([res.ok, res.status, res.message, res.details], [
		false,
		403,
		"Complete business verification (KYB) before paying from this account.",
		{ reason: "kyb_required" },
	]);
	const other = billingRefusal({
		code: "42501",
		message: "Only a member who manages this account's billing can pay its invoices",
	});
	assertEquals([other.status, other.details], [403, undefined]);
});

Deno.test("a Business Pro refusal names the entitlement for the upgrade notice", () => {
	const res = billingRefusal({
		code: "PK402",
		message: "entitlement: intervaled_invoicing: monthly invoicing is part of Business Pro",
	});
	assertEquals([res.status, res.details?.reason, res.details?.entitlement], [
		402,
		"entitlement",
		"intervaled_invoicing",
	]);
});
// #endregion
