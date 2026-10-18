import { assertEquals } from "@std/assert";
import type { BillingInvoiceRow, BusinessBillingView } from "@projective/types/finance";
import type { BusinessKyb } from "@projective/types/workspace";
import { safeBack, walletIntentOf } from "@features/wallet/core/wallet-intent.ts";
import {
	billingCommits,
	billingDayOptions,
	billingGate,
	billingRefusalSentence,
	invoicesMeta,
	oldestPayable,
	ONE_WAY,
	payRefusalIsFinal,
	refusalGate,
	reviewFor,
	STATEMENTS_META,
	termsAvailability,
	termsReadOnlyReason,
	topUpHrefFor,
} from "./billing-model.ts";

/**
 * The Billing module's decisions (BU3, Decision #247): one amber control per page, every Pay through a
 * review, gates worded from the refusal map in the database's order, terms open by the door's rules.
 */

const HELIA = "edb582e0-25d2-48a3-a0db-4a96f1d1a8d1";

function invoice(id: string, over: Partial<BillingInvoiceRow> = {}): BillingInvoiceRow {
	return {
		id: `00000000-0000-4000-8000-0000000000${id}`,
		periodLabel: "Aug 28 – Sep 28, 2026",
		currency: "USD",
		totalLabel: "US$640.00",
		amountDueMinor: 64000,
		amountDueLabel: "US$640.00",
		status: "issued",
		dueLabel: "Due Oct 22",
		overdue: false,
		pdfHref: `/api/finance/invoices/${id}/pdf`,
		issuedAt: "2026-09-28T03:00:00.000Z",
		issuedLabel: "Sep 28",
		dueDateLabel: "Oct 22",
		walletBalanceLabel: "US$8,873.00",
		balanceAfterLabel: "US$8,233.00",
		covered: true,
		shortfallLabel: null,
		...over,
	};
}

// Newest period first, as the server sends them: B (Sep) is newer than A (Aug), which is older.
const B = invoice("bb", { periodLabel: "Aug 28 – Sep 28, 2026" });
const A = invoice("aa", {
	periodLabel: "Jul 28 – Aug 28, 2026",
	amountDueMinor: 120000,
	amountDueLabel: "US$1,200.00",
	status: "overdue",
	overdue: true,
	balanceAfterLabel: "US$7,673.00",
});
const PAID = invoice("cc", {
	status: "paid",
	amountDueMinor: 0,
	amountDueLabel: "US$0.00",
	covered: false,
});

// #region One amber per page
Deno.test("two payable invoices: exactly one tier-1 Pay, on the OLDEST; the other gets a row Pay", () => {
	const commits = billingCommits({
		canPay: true,
		rows: [B, A, PAID],
		belowFloor: false,
		canTopUp: true,
	});
	assertEquals(commits.pay?.id, A.id);
	assertEquals([...commits.rowPay], [B.id]);
	assertEquals(commits.topUp, null);
	assertEquals(oldestPayable([B, A, PAID])?.id, A.id);
});

Deno.test("below the floor beside a Pay, Top up drops to tier 4 — still one amber", () => {
	const commits = billingCommits({ canPay: true, rows: [B, A], belowFloor: true, canTopUp: true });
	assertEquals([commits.pay?.id, commits.topUp], [A.id, { tier: 4 }]);
});

Deno.test("below the floor with no Pay, Top up is the page's one amber", () => {
	assertEquals(
		billingCommits({ canPay: true, rows: [PAID], belowFloor: true, canTopUp: true }).topUp,
		{ tier: 1 },
	);
	const cannotPay = billingCommits({
		canPay: false,
		rows: [B, A],
		belowFloor: true,
		canTopUp: true,
	});
	assertEquals([cannotPay.pay, cannotPay.rowPay.size, cannotPay.topUp], [null, 0, { tier: 1 }]);
});

Deno.test("without the right to add money there is no Top up control at all", () => {
	assertEquals(
		billingCommits({ canPay: false, rows: [], belowFloor: true, canTopUp: false }).topUp,
		null,
	);
	assertEquals(
		billingCommits({ canPay: true, rows: [B], belowFloor: false, canTopUp: true }).topUp,
		null,
	);
});

Deno.test("the invariant: never two tier-1 controls, whatever the inputs", () => {
	for (const canPay of [true, false]) {
		for (const belowFloor of [true, false]) {
			for (const canTopUp of [true, false]) {
				for (const rows of [[], [PAID], [B], [B, A]]) {
					const c = billingCommits({ canPay, rows, belowFloor, canTopUp });
					const amber = (c.pay ? 1 : 0) + (c.topUp?.tier === 1 ? 1 : 0);
					assertEquals(
						amber <= 1,
						true,
						JSON.stringify({ canPay, belowFloor, canTopUp, n: rows.length }),
					);
				}
			}
		}
	}
});
// #endregion

// #region The review
const CTX = {
	businessName: "Helia Finance",
	topUpHref: topUpHrefFor(HELIA, "heliafinance"),
	canTopUp: true,
	currency: "USD",
};

Deno.test("a covered invoice reviews the amount, the wallet it leaves and the balance before and after", () => {
	const review = reviewFor(A, CTX);
	// The commit's amount is its own figure ("Pay" · "US$1,200.00"), set tabular inside the pill.
	assertEquals([review.mode, review.total, review.commitLabel, review.commitFigure], [
		"action",
		"US$1,200.00",
		"Pay",
		"US$1,200.00",
	]);
	assertEquals(review.rows, [
		{ label: "Invoice", value: "Jul 28 – Aug 28, 2026" },
		{ label: "From", value: "Helia Finance's wallet" },
		{ label: "Balance now", value: "US$8,873.00", tabular: true },
		{ label: "Balance after", value: "US$7,673.00", tabular: true },
	]);
});

Deno.test("a wallet short of the invoice: the review says by how much and hands off to the top-up", () => {
	const short = invoice("dd", {
		covered: false,
		balanceAfterLabel: null,
		shortfallLabel: "US$1,127.00",
	});
	const review = reviewFor(short, CTX);
	assertEquals([review.mode, review.commitLabel, review.commitHref], [
		"link",
		"Top up the wallet",
		CTX.topUpHref,
	]);
	assertEquals(review.rows.at(-1), { label: "Short by", value: "US$1,127.00", tabular: true });
	const stuck = reviewFor(short, { ...CTX, canTopUp: false });
	assertEquals([stuck.mode, stuck.commitLabel, stuck.commitHref], ["none", null, null]);
	assertEquals(
		stuck.consequence.endsWith("Ask someone who can add money to top up the business wallet."),
		true,
	);
});

Deno.test("an invoice in another currency: a top-up adds the billing currency, so no hand-off is offered", () => {
	const eur = invoice("ee", {
		currency: "EUR",
		amountDueLabel: "€640.00",
		walletBalanceLabel: "€0.00",
		covered: false,
		balanceAfterLabel: null,
		shortfallLabel: "€640.00",
	});
	const review = reviewFor(eur, CTX);
	assertEquals([review.mode, review.commitLabel, review.commitHref], ["none", null, null]);
	assertEquals(
		review.consequence,
		"The wallet holds less EUR than this invoice, and a top-up adds USD, so it can't cover this one.",
	);
	assertEquals(
		reviewFor({ ...eur, covered: true, balanceAfterLabel: "€10.00" }, CTX).mode,
		"action",
	);
});

Deno.test("an invoice paid while its review was open: no figure, no commit, just what it now reads", () => {
	const paid = invoice("ff", {
		status: "paid",
		amountDueMinor: 0,
		amountDueLabel: "US$0.00",
		dueLabel: "Paid Oct 17",
		covered: false,
		balanceAfterLabel: null,
	});
	const review = reviewFor(paid, CTX);
	assertEquals([review.mode, review.total, review.commitLabel], ["none", null, null]);
	assertEquals(review.rows.at(-1), { label: "Status", value: "Paid Oct 17", tabular: true });
	assertEquals(review.consequence, "Nothing is due on this invoice now.");
});

Deno.test("a Pay refused for good re-reviews with no commit — never the same Pay on Try again", () => {
	const review = reviewFor(A, { ...CTX, blocked: true });
	assertEquals([review.mode, review.commitLabel, review.commitFigure, review.commitHref], [
		"none",
		null,
		null,
		null,
	]);
	assertEquals([review.total, review.consequence], ["US$1,200.00", "Nothing was paid."]);
	assertEquals(review.rows.map((r) => r.label), ["Invoice", "From", "Balance now"]);
});

Deno.test("which refused Pays are final: inactive, KYB, or a re-read that can no longer pay", () => {
	const canPay = { canPay: true } as BusinessBillingView;
	const cannot = { canPay: false } as BusinessBillingView;
	assertEquals(
		payRefusalIsFinal({ details: { reason: "business_not_active" }, data: canPay }),
		true,
	);
	assertEquals(payRefusalIsFinal({ details: { reason: "kyb_required" } }), true);
	// The billing right was taken away: a 403 naming nothing, but the re-read says can_pay is false.
	assertEquals(payRefusalIsFinal({ details: undefined, data: cannot }), true);
	// A wallet that ran short, an invoice paid by someone else, an unexplained refusal: retryable.
	assertEquals(payRefusalIsFinal({ details: undefined, data: canPay }), false);
	assertEquals(payRefusalIsFinal({ details: { reason: "entitlement" } }), false);
	assertEquals(payRefusalIsFinal({}), false);
});

Deno.test("after a final refusal the page says the review's sentence; KYB links to Verification", () => {
	const ctx = { business: "Helia Finance", handle: "heliafinance", kybStatus: "pending" };
	assertEquals(refusalGate("kyb_required", "Verify first.", ctx), {
		kind: "kyb",
		sentence: "Verify first.",
		action: { label: "See verification", href: "/businesses/heliafinance/verification" },
	});
	assertEquals(refusalGate("business_not_active", "Not active.", ctx), {
		kind: "refused",
		sentence: "Not active.",
		action: null,
	});
	assertEquals(refusalGate(undefined, "No right.", ctx).action, null);
});

Deno.test("the top-up hand-off opens the business wallet and comes back to this Billing module", () => {
	const url = new URL(CTX.topUpHref, "https://projective.test");
	assertEquals(url.searchParams.get("w"), `business:${HELIA}`);
	assertEquals(walletIntentOf(url.searchParams), {
		action: "top_up",
		back: "/businesses/heliafinance/billing",
	});
	assertEquals(safeBack(url.searchParams.get("back")), "/businesses/heliafinance/billing");
});
// #endregion

// #region Refusals
Deno.test("a refused save or Pay reads the refusal map's sentence for the codes it words", () => {
	const ctx = { business: "Helia Finance" };
	assertEquals(
		billingRefusalSentence(
			{ message: "Publish the business first.", details: { reason: "business_not_active" } },
			ctx,
			"x",
		),
		"Helia Finance isn't active, so it can't buy, hire or pay yet.",
	);
	assertEquals(
		billingRefusalSentence(
			{ message: "Monthly invoicing is part of Business Pro.", details: { reason: "entitlement" } },
			ctx,
			"x",
		),
		"That's part of Business Pro, which Helia Finance isn't on.",
	);
	assertEquals(
		billingRefusalSentence(
			{ details: { reason: "kyb_required" } },
			{ ...ctx, kybStatus: "pending" },
			"x",
		),
		"Helia Finance's verification is still in review. You can pay once it clears.",
	);
});

Deno.test("a refusal the map does not word keeps the server's sentence, else the fallback", () => {
	const ctx = { business: "Helia Finance" };
	assertEquals(
		billingRefusalSentence(
			{ message: "This invoice has nothing to pay.", details: { reason: "nope" } },
			ctx,
			"Could not pay that invoice.",
		),
		"This invoice has nothing to pay.",
	);
	assertEquals(
		billingRefusalSentence({}, ctx, "Could not pay that invoice."),
		"Could not pay that invoice.",
	);
});
// #endregion

// #region Gates
const KYB = (over: Partial<BusinessKyb>): BusinessKyb => ({
	status: "pending",
	verifiedAt: null,
	connectOnboardingUrl: null,
	requirementsDue: [],
	processorConnected: false,
	...over,
});
const GATE = {
	kyb: null,
	verification: "verified" as const,
	isOwner: true,
	name: "Atlas Labs",
	handle: "atlaslabs",
};

Deno.test("an active, verified business has no gate", () => {
	assertEquals(billingGate({ ...GATE, status: "active", kyb: KYB({ status: "verified" }) }), null);
});

Deno.test("KYB in review: the map's sentence and See verification, landing on the Verification module", () => {
	assertEquals(billingGate({ ...GATE, status: "active", kyb: KYB({ status: "pending" }) }), {
		kind: "kyb",
		sentence: "Atlas Labs' verification is still in review. You can pay once it clears.",
		action: { label: "See verification", href: "/businesses/atlaslabs/verification" },
	});
	const rejected = billingGate({
		...GATE,
		status: "active",
		kyb: KYB({ requirementsDue: ["kyb_rejected"] }),
	});
	assertEquals(
		rejected?.sentence,
		"Atlas Labs' verification needs attention before its wallet can pay for anything.",
	);
	assertEquals(rejected?.action?.label, "Verify Atlas Labs");
	const unread = billingGate({ ...GATE, status: "active", verification: "unverified" });
	assertEquals(
		unread?.sentence,
		"Atlas Labs needs to be verified before its wallet can pay for anything.",
	);
});

Deno.test("an inactive business is said before KYB; a draft has no link, an archive is the owner's to restore", () => {
	const draft = billingGate({ ...GATE, status: "draft", kyb: KYB({ status: "pending" }) });
	assertEquals(draft, {
		kind: "draft",
		sentence: "Atlas Labs isn't active, so it can't buy, hire or pay yet.",
		action: null,
	});
	assertEquals(billingGate({ ...GATE, status: "archived" })?.action, {
		label: "See archived businesses",
		href: "/businesses?tab=archived",
	});
	assertEquals(billingGate({ ...GATE, status: "archived", isOwner: false })?.action, null);
});
// #endregion

// #region Terms
const TERMS = {
	status: "active" as const,
	kybVerified: true,
	planAllowsMonthly: true,
	canEdit: true,
};

Deno.test("Helia — monthly on Business Free: the day is fixed, the Business Pro notice shows, per transaction stays open", () => {
	const t = termsAvailability({ ...TERMS, planAllowsMonthly: false, mode: "intervaled_monthly" });
	assertEquals([t.modeDisabled, t.monthlyOptionDisabled, t.dayDisabled, t.notice], [
		false,
		false,
		true,
		"entitlement",
	]);
	// Leaving monthly cannot be undone on Free (set_invoicing_terms refuses the way back), so the hint
	// says so before the Save.
	assertEquals(t.hint.endsWith(ONE_WAY), true, t.hint);
	assertEquals(ONE_WAY, "Switching to per transaction can't be undone without Business Pro.");
	const perTx = termsAvailability({ ...TERMS, planAllowsMonthly: false, mode: "per_transaction" });
	assertEquals([perTx.monthlyOptionDisabled, perTx.notice], [true, "entitlement"]);
	assertEquals(perTx.hint.includes(ONE_WAY), false);
});

Deno.test("Atlas — KYB pending on per transaction: monthly cannot be chosen", () => {
	const t = termsAvailability({ ...TERMS, kybVerified: false, mode: "per_transaction" });
	assertEquals([t.modeDisabled, t.monthlyOptionDisabled, t.notice, t.hint], [
		false,
		true,
		null,
		"Monthly invoicing needs business verification.",
	]);
});

Deno.test("a draft business: the invoicing switch closes (auto-funding and the floor are not terms)", () => {
	const t = termsAvailability({ ...TERMS, status: "draft", mode: "per_transaction" });
	assertEquals([t.modeDisabled, t.dayDisabled, t.notice], [true, true, null]);
});

Deno.test("the plan gate is said before KYB, as the database refuses", () => {
	const t = termsAvailability({
		...TERMS,
		kybVerified: false,
		planAllowsMonthly: false,
		mode: "per_transaction",
	});
	assertEquals(t.notice, "entitlement");
});

Deno.test("the billing right without the footer's Save: the terms are read-only and say why", () => {
	const t = termsAvailability({ ...TERMS, canSave: false, mode: "intervaled_monthly" });
	assertEquals([t.modeDisabled, t.monthlyOptionDisabled, t.dayDisabled, t.notice, t.hint], [
		true,
		true,
		true,
		null,
		"Saving these also needs the right to manage finances.",
	]);
	assertEquals(
		termsReadOnlyReason(true, false),
		"Saving these also needs the right to manage finances",
	);
	assertEquals(
		termsReadOnlyReason(false, true),
		"Only members who manage billing can change these",
	);
	assertEquals(termsReadOnlyReason(true, true), null);
	// Without the billing right, that is the reason given — whatever the Save.
	assertEquals(
		termsReadOnlyReason(false, false),
		"Only members who manage billing can change these",
	);
});

Deno.test("a verified business on Business Pro: everything open", () => {
	const t = termsAvailability({ ...TERMS, mode: "intervaled_monthly" });
	assertEquals([t.modeDisabled, t.monthlyOptionDisabled, t.dayDisabled, t.notice], [
		false,
		false,
		false,
		null,
	]);
});
// #endregion

// #region Copy
Deno.test("the billing day picker runs 1st to 28th", () => {
	const options = billingDayOptions();
	assertEquals(options.length, 28);
	assertEquals([options[0], options[1], options[2], options[20], options[27]], [
		{ label: "1st", value: "1" },
		{ label: "2nd", value: "2" },
		{ label: "3rd", value: "3" },
		{ label: "21st", value: "21" },
		{ label: "28th", value: "28" },
	]);
});

Deno.test("the Invoices meta says the billing day from data, and figures are tabular", () => {
	const view = {
		invoicingMode: "intervaled_monthly",
		billingDay: 28,
		nextInvoiceLabel: "Next invoice Oct 28",
		onAccount: { owedLabel: "US$0.00", limitLabel: "US$25,000.00" },
	} as BusinessBillingView;
	assertEquals(invoicesMeta(view), [
		{ text: "Issued on the 28th", tabular: true },
		{ text: "Next invoice Oct 28", tabular: true },
		{ text: "US$0.00 owed on account of US$25,000.00", tabular: true },
	]);
	assertEquals(invoicesMeta({ ...view, invoicingMode: "per_transaction" }), [
		"Settled per transaction",
	]);
	assertEquals(
		invoicesMeta({ ...view, billingDay: null, onAccount: null })[0],
		{ text: "Issued on the 1st", tabular: true },
	);
	// Statements stay on the 1st whatever the billing day (Decision #168), and the day is a figure.
	assertEquals(STATEMENTS_META, [{ text: "Issued on the 1st", tabular: true }]);
});
// #endregion
