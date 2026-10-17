import { assertEquals } from "@std/assert";
import { toBillingView, toInvoiceRow } from "./BillingBackendService.ts";

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
