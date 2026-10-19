import {
	AutoFundMode,
	billingPeriod,
	type BillingInvoiceRow,
	type BillingStatementRow,
	type BusinessBillingView,
	formatMoney,
	InvoiceStatus,
	type UpdateBillingInput,
} from "@projective/types/finance";
import { planGateHeaders, planGateRefusal } from "../../core/plan-gate.ts";
import { getUserClient } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

/**
 * BillingBackendService — the fat half of the business console's Billing module (PRODUCT_SPEC §Escrow,
 * Wallets & Finance #4): the monthly invoices and their Pay action, statement PDFs, invoicing terms,
 * auto-funding and the low-balance floor. Live only, as the signed-in caller: every read goes through
 * RLS or a definer read that checks membership (`finance.get_billing_settings`), and every write through
 * a door that checks `manage_billing` itself (`set_invoicing_terms`, `set_billing_controls`,
 * `pay_invoice`). A guest gets a 401, a non-member a 404.
 */

type Row = Record<string, unknown>;
type Result<T> = ServiceResult<T>;

const SIGNED_OUT = fail(401, { message: "Sign in to see billing." });
const NOT_FOUND = fail(404, { message: "We couldn't find that business's billing." });
const UNREACHABLE = fail(503, { message: "We couldn't reach billing just now. Try again in a moment." });

const DAY = 86_400_000;
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const SHORT_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// #region Projection
/** The raw facts {@link toBillingView} projects — what the live read collects, in one place. */
export interface BillingFacts {
	settings: Row;
	/** The default-currency wallet's balance — the floor's and the headline's. */
	balanceMinor: number;
	/**
	 * Every business wallet's balance by upper-case currency, so an invoice in another currency is
	 * covered (or not) by the wallet Pay would debit. Absent: only the default currency is known.
	 */
	balances?: Record<string, number>;
	standing: Row | null;
	invoices: Row[];
	statements: Row[];
	/** The viewer's Dev Context Switcher never reaches here; this is the server's clock. */
	now: Date;
}

const num = (v: unknown): number => {
	const n = typeof v === "string" ? Number(v) : v;
	return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * One invoice row: what is owed and by when, in the reader's words, and what paying it would leave in
 * the wallet it debits (`balanceMinor`, the business wallet in the invoice's currency; `0` when there
 * is none). Every figure is formatted here, in minor units — the island never does money math.
 */
export function toInvoiceRow(row: Row, now: Date, balanceMinor = 0): BillingInvoiceRow {
	const currency = String(row.currency ?? "USD").toUpperCase();
	const status = InvoiceStatus.safeParse(row.status).data ?? "issued";
	const due = row.due_date ? new Date(String(row.due_date)) : null;
	const overdue = status === "overdue" || (status === "issued" && due !== null && due.getTime() < now.getTime());
	const owed = status === "issued" || status === "overdue" ? num(row.amount_due_cents) : 0;
	const days = due ? Math.ceil((now.getTime() - due.getTime()) / DAY) : 0;
	const dueLabel = status === "paid"
		? (row.paid_at ? `Paid ${SHORT.format(new Date(String(row.paid_at)))}` : "Paid")
		: status === "void"
		? "Void"
		: overdue
		? `Overdue ${Math.max(days, 1)} ${Math.max(days, 1) === 1 ? "day" : "days"}`
		: due
		? `Due ${SHORT.format(due)}`
		: "No due date";
	const start = row.billing_period_start ? new Date(String(row.billing_period_start)) : null;
	const end = row.billing_period_end ? new Date(String(row.billing_period_end)) : null;
	const issued = row.created_at ? new Date(String(row.created_at)) : null;
	const issuedAt = issued && Number.isFinite(issued.getTime()) ? issued : null;
	const held = Math.max(balanceMinor, 0);
	const covered = owed > 0 && held >= owed;
	return {
		id: String(row.id),
		periodLabel: start && end ? `${SHORT.format(start)} – ${SHORT_YEAR.format(end)}` : "Invoice",
		currency,
		totalLabel: formatMoney(num(row.total_cents), currency),
		amountDueMinor: owed,
		amountDueLabel: formatMoney(owed, currency),
		status: overdue ? "overdue" : status,
		dueLabel,
		overdue,
		pdfHref: `/api/finance/invoices/${String(row.id)}/pdf`,
		issuedAt: issuedAt ? issuedAt.toISOString() : null,
		issuedLabel: issuedAt ? SHORT.format(issuedAt) : "—",
		dueDateLabel: due ? SHORT.format(due) : "—",
		walletBalanceLabel: formatMoney(held, currency),
		balanceAfterLabel: covered ? formatMoney(held - owed, currency) : null,
		covered,
		shortfallLabel: owed > 0 && !covered ? formatMoney(owed - held, currency) : null,
	};
}

/** How many invoices the module lists, newest billing period first. */
export const INVOICE_WINDOW = 36;

/** Whether a raw invoice row still has something to pay: issued or overdue, with an amount due. */
function owes(row: Row): boolean {
	return (row.status === "issued" || row.status === "overdue") && num(row.amount_due_cents) > 0;
}

/**
 * The invoices the module lists: the newest {@link INVOICE_WINDOW} by billing period, plus every older
 * invoice that still has something to pay. The band's Pay names the OLDEST payable invoice, and an
 * unpaid one blocks archiving, so the window never cuts one off. Deduplicated by id, newest first.
 */
export function invoiceWindow(rows: readonly Row[]): Row[] {
	const seen = new Set<string>();
	const unique = rows.filter((row) => {
		const id = String(row.id);
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
	const period = (row: Row) => String(row.billing_period_start ?? "");
	return unique
		.sort((a, b) => period(b).localeCompare(period(a)))
		.filter((row, i) => i < INVOICE_WINDOW || owes(row));
}

/** The Billing module's projection — pure, so the labels and the floor test are pinned by test. */
export function toBillingView(f: BillingFacts): BusinessBillingView {
	const s = f.settings;
	const currency = String(s.currency ?? "USD").toUpperCase();
	const monthly = s.invoicing_mode === "intervaled_monthly";
	const billingDay = typeof s.billing_day === "number" ? s.billing_day : null;
	const floor = s.low_balance_floor_cents === null || s.low_balance_floor_cents === undefined
		? null
		: num(s.low_balance_floor_cents) || null;
	const statements: BillingStatementRow[] = f.statements.map((row) => {
		const c = String(row.currency ?? currency).toUpperCase();
		return {
			id: String(row.id),
			periodLabel: MONTH.format(new Date(String(row.period_start))),
			currency: c,
			closingLabel: formatMoney(num(row.closing_balance_cents), c),
			pdfHref: `/api/finance/statements/${String(row.id)}/pdf`,
		};
	});
	return {
		businessId: String(s.business_id),
		currency,
		invoicingMode: monthly ? "intervaled_monthly" : "per_transaction",
		billingDay,
		kybVerified: s.kyb_verified === true,
		autoFundMode: AutoFundMode.safeParse(s.auto_fund_mode).data ?? "off",
		lowBalanceFloorMinor: floor,
		balanceMinor: Math.max(f.balanceMinor, 0),
		balanceLabel: formatMoney(Math.max(f.balanceMinor, 0), currency),
		belowFloor: floor !== null && f.balanceMinor < floor,
		nextInvoiceLabel: monthly ? `Next invoice ${SHORT.format(billingPeriod(billingDay, f.now).end)}` : null,
		onAccount: monthly && f.standing
			? {
				owedLabel: formatMoney(num(f.standing.owed_minor), currency),
				limitLabel: formatMoney(num(f.standing.limit_minor), currency),
			}
			: null,
		invoices: invoiceWindow(f.invoices).map((row) => {
			const c = String(row.currency ?? currency).toUpperCase();
			const held = f.balances?.[c] ?? (c === currency ? f.balanceMinor : 0);
			return toInvoiceRow(row, f.now, held);
		}),
		statements: statements.slice(0, 24),
		canManage: s.can_manage === true,
		canPay: s.can_pay === true,
		// A database that predates the key reads as open; set_invoicing_terms still refuses with PK402.
		planAllowsMonthly: s.plan_allows_monthly !== false,
	};
}
// #endregion

// #region Live
/**
 * Read every fact the module shows, as the caller, with their Dev Context Switcher plan-gates override
 * (which can only make the Business Pro read stricter). `null` when they may not see this business's
 * finances.
 */
async function readView(actor: ReadActor, businessId: string): Promise<BusinessBillingView | null> {
	if (!actor.accessToken) throw new Error("billing read without a session");
	const finance = getUserClient(actor.accessToken, planGateHeaders(actor.planGatesOverride))
		.schema("finance");
	const settings = await finance.rpc("get_billing_settings", { p_business_id: businessId });
	if (settings.error) throw new Error(`finance.get_billing_settings failed: ${settings.error.message}`);
	if (!settings.data) return null;
	const s = settings.data as Row;
	const currency = String(s.currency ?? "USD").toUpperCase();
	const invoiceColumns =
		"id, currency, status, total_cents, amount_due_cents, due_date, paid_at, billing_period_start, billing_period_end, created_at";
	const [wallets, standing, invoices, payable, statements] = await Promise.all([
		finance.from("wallets").select("currency, balance_cents")
			.eq("owner_type", "business").eq("owner_id", businessId),
		finance.rpc("get_on_account_standing", { p_business_id: businessId, p_currency: currency }),
		finance.from("invoices")
			.select(invoiceColumns)
			.eq("issue_to_business_id", businessId)
			.eq("invoice_type", "consolidated_monthly")
			.order("billing_period_start", { ascending: false })
			.limit(INVOICE_WINDOW),
		// Every invoice with something to pay, oldest first, whatever the window (`invoiceWindow`).
		finance.from("invoices")
			.select(invoiceColumns)
			.eq("issue_to_business_id", businessId)
			.eq("invoice_type", "consolidated_monthly")
			.in("status", ["issued", "overdue"])
			.gt("amount_due_cents", 0)
			.order("billing_period_start", { ascending: true })
			.limit(120),
		finance.from("statements")
			.select("id, currency, period_start, closing_balance_cents")
			.eq("owner_type", "business").eq("owner_id", businessId)
			.order("period_start", { ascending: false })
			.limit(24),
	]);
	for (const r of [wallets, standing, invoices, payable, statements]) {
		if (r.error) throw new Error(`billing read failed: ${r.error.message}`);
	}
	const balances: Record<string, number> = {};
	for (const w of (wallets.data ?? []) as Row[]) {
		balances[String(w.currency ?? "").toUpperCase()] = num(w.balance_cents);
	}
	return toBillingView({
		settings: s,
		balanceMinor: balances[currency] ?? 0,
		balances,
		standing: (standing.data as Row | null) ?? null,
		invoices: [...(invoices.data ?? []), ...(payable.data ?? [])] as Row[],
		statements: (statements.data ?? []) as Row[],
		now: new Date(),
	});
}

/** The 55000 sub-code a draft or archived business's billing door refuses with. */
const NOT_ACTIVE = /^business_not_active:\s*/i;
/** The PK403 sub-code `pay_invoice` refuses a business that is not KYB-verified with (#247 (h)). */
const KYB_REQUIRED = /^kyb_required:\s*/i;

/** A refusal's remainder as a sentence: capitalised and closed. */
function sentenceOf(rest: string, fallback: string): string {
	const text = rest ? rest[0].toUpperCase() + rest.slice(1) : fallback;
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * A database refusal in the reader's words, by the SQLSTATE the billing doors raise. A refusal the
 * business refusal map words carries its code in `details.reason` (`business_not_active`,
 * `kyb_required`, `entitlement`), so the screen says it in the map's sentence (Decision #243).
 * Anything else is thrown, and answered as unreachable.
 */
export function billingRefusal(
	error: { code?: string; message: string; hint?: string | null },
): Result<never> {
	const message = error.message.replace(/^[a-zA-Z]+: /, "").slice(0, 200);
	switch (error.code) {
		case "55000": {
			// A state, not a fault. Only `org.fn_assert_business_active`'s sub-code names the business
			// as inactive; any other 55000 (a trigger, a wallet path) keeps its own sentence and no code.
			if (!NOT_ACTIVE.test(error.message)) return fail(409, { message }) as Result<never>;
			const rest = error.message.replace(NOT_ACTIVE, "").trim().slice(0, 200);
			return fail(409, {
				message: sentenceOf(rest, "This business isn't active"),
				details: { reason: "business_not_active" },
			}) as Result<never>;
		}
		case "PK402": {
			// A Business Pro gate (monthly invoicing): a 402 naming the entitlement, for the upgrade notice.
			const gate = planGateRefusal(error);
			return fail(gate.status, { message: gate.message, details: gate.details }) as Result<never>;
		}
		case "PK403":
			if (KYB_REQUIRED.test(error.message)) {
				const rest = error.message.replace(KYB_REQUIRED, "").trim().slice(0, 200);
				return fail(403, {
					message: sentenceOf(rest, "Verify the business first"),
					details: { reason: "kyb_required" },
				}) as Result<never>;
			}
			return fail(403, { message }) as Result<never>;
		case "42501":
			return fail(403, { message }) as Result<never>;
		case "22023":
			return fail(422, { message }) as Result<never>;
		case "P0002":
		case "PB404":
			return fail(404, { message }) as Result<never>;
		case "PC409":
			return fail(409, { message }) as Result<never>;
		case "PF402":
			return fail(402, { message }) as Result<never>;
		default:
			throw new Error(error.message);
	}
}
// #endregion

export class BillingBackendService {
	/** The Billing module's projection for one business. */
	static async view(businessId: string, actor: ReadActor): Promise<Result<BusinessBillingView>> {
		if (!canReadLive(actor) || !actor.accessToken) return SIGNED_OUT as Result<BusinessBillingView>;
		try {
			const view = await readView(actor, businessId);
			return view ? ok(view) : NOT_FOUND as Result<BusinessBillingView>;
		} catch (error) {
			console.error("[billing:view]", error instanceof Error ? error.message : error);
			return UNREACHABLE as Result<BusinessBillingView>;
		}
	}

	/**
	 * Save the module's settings: invoicing terms through `finance.set_invoicing_terms`, auto-funding and
	 * the floor through `finance.set_billing_controls`. Each is written only when the patch carries it.
	 */
	static async update(input: UpdateBillingInput, actor: ReadActor): Promise<Result<BusinessBillingView>> {
		if (!canReadLive(actor) || !actor.accessToken) return SIGNED_OUT as Result<BusinessBillingView>;
		try {
			const current = await readView(actor, input.businessId);
			if (!current) return NOT_FOUND as Result<BusinessBillingView>;
			const finance = getUserClient(actor.accessToken, planGateHeaders(actor.planGatesOverride))
				.schema("finance");
			if (input.invoicingMode !== undefined || input.billingDay !== undefined) {
				const { error } = await finance.rpc("set_invoicing_terms", {
					p_owner_type: "business",
					p_owner_id: input.businessId,
					p_mode: input.invoicingMode ?? current.invoicingMode,
					p_billing_day: input.billingDay ?? null,
				});
				if (error) return billingRefusal(error);
			}
			if (input.autoFundMode !== undefined || input.lowBalanceFloorMinor !== undefined) {
				const { error } = await finance.rpc("set_billing_controls", {
					p_business_id: input.businessId,
					p_auto_fund_mode: input.autoFundMode ?? current.autoFundMode,
					p_low_balance_floor_cents: input.lowBalanceFloorMinor !== undefined
						? input.lowBalanceFloorMinor
						: current.lowBalanceFloorMinor,
				});
				if (error) return billingRefusal(error);
			}
			const view = await readView(actor, input.businessId);
			return view ? ok(view, { message: "Billing saved." }) : NOT_FOUND as Result<BusinessBillingView>;
		} catch (error) {
			console.error("[billing:update]", error instanceof Error ? error.message : error);
			return UNREACHABLE as Result<BusinessBillingView>;
		}
	}

	/**
	 * Pay an invoice's amount due from the business wallet (`finance.pay_invoice`), then re-read the module.
	 *
	 * The re-read is NOT part of the payment: once the door has paid, a failed read still answers ok
	 * ("Invoice paid.", no view), never a 503 that would tell the reader a payment that went through had
	 * failed. A refusal carries the re-read view when it can be read, so a review that was out of date
	 * (the wallet drained, the invoice paid by someone else) shows what is true now instead of offering
	 * the same refused commit again.
	 */
	static async payInvoice(invoiceId: string, actor: ReadActor): Promise<Result<BusinessBillingView>> {
		if (!canReadLive(actor) || !actor.accessToken) return SIGNED_OUT as Result<BusinessBillingView>;
		let businessId: string;
		try {
			const finance = getUserClient(actor.accessToken).schema("finance");
			const invoice = await finance.from("invoices").select("issue_to_business_id").eq("id", invoiceId).maybeSingle();
			if (invoice.error) throw new Error(invoice.error.message);
			if (!invoice.data) return fail(404, { message: "That invoice wasn't found." }) as Result<BusinessBillingView>;
			businessId = String((invoice.data as Row).issue_to_business_id);
			const { error } = await finance.rpc("pay_invoice", { p_invoice_id: invoiceId });
			if (error) {
				const refusal = billingRefusal(error);
				const fresh = await readView(actor, businessId).catch(() => null);
				return fresh ? { ...refusal, data: fresh } : refusal;
			}
		} catch (error) {
			console.error("[billing:pay]", error instanceof Error ? error.message : error);
			return UNREACHABLE as Result<BusinessBillingView>;
		}
		const view = await readView(actor, businessId).catch((error) => {
			console.error("[billing:pay:reread]", error instanceof Error ? error.message : error);
			return null;
		});
		return view
			? ok(view, { message: "Invoice paid." })
			: { ok: true, status: 200, message: "Invoice paid." };
	}
}
