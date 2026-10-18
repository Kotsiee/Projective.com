import type { CommitReviewRow } from "@ui/feedback/core/commit-review.ts";
import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import {
	billingDayOrdinal,
	type BillingInvoiceRow,
	type BusinessBillingView,
	type InvoicingMode,
} from "@projective/types/finance";
import {
	type BusinessKyb,
	type VerificationState,
	workspaceHref,
	type WorkspaceStatus,
} from "@projective/types/workspace";
import { walletIntentHref } from "@features/wallet/core/wallet-intent.ts";
import { BUSINESS_REFUSAL_COPY, possessive } from "./refusal-copy.ts";

/**
 * billing-model — what the business console's Billing module offers, decided from the server's
 * projection alone (BU3, Decision #247). Pure, so the one-amber rule, the gates and the review are
 * pinned by `billing-model.test.ts`, and the server's first paint and hydration agree.
 *
 *  - **One amber per page.** The oldest payable invoice gets the band's tier-1 Pay; every other
 *    payable row a tier-5 Pay opening the same review. The balance band's Top up is tier 1 only while
 *    no Pay renders; beside a Pay it is tier 4, so the page never holds two amber controls.
 *  - **Every Pay passes through a review** ({@link reviewFor}): the amount, the wallet it leaves, the
 *    balance now and after. A wallet that does not cover it turns the commit into the top-up hand-off,
 *    so amber never sits on a commit the database would refuse.
 *  - **Gates are worded from the refusal map** (`refusal-copy.ts`), in the database's order: an
 *    inactive business, then KYB.
 *
 * A LEAF: type-only UI imports, so `deno test` can load it.
 */

// #region Day options
/** The billing day picker's options: the 1st … the 28th (days stop at 28, so every month has one). */
export function billingDayOptions(): { label: string; value: string }[] {
	return Array.from(
		{ length: 28 },
		(_, i) => ({ label: billingDayOrdinal(i + 1), value: String(i + 1) }),
	);
}
// #endregion

// #region Invoices
/** Whether an invoice has something to pay. */
export function isPayable(row: BillingInvoiceRow): boolean {
	return row.amountDueMinor > 0 && (row.status === "issued" || row.status === "overdue");
}

/** The payable invoices, in the server's order (newest period first). */
export function payableRows(rows: readonly BillingInvoiceRow[]): BillingInvoiceRow[] {
	return rows.filter(isPayable);
}

/** The oldest payable invoice — the last payable row, since rows arrive newest first — or `null`. */
export function oldestPayable(rows: readonly BillingInvoiceRow[]): BillingInvoiceRow | null {
	const payable = payableRows(rows);
	return payable[payable.length - 1] ?? null;
}

/** The Invoices band's meta: when invoices are issued, the next one, and what is owed on account. */
export function invoicesMeta(view: BusinessBillingView): MetaLineEntry[] {
	if (view.invoicingMode !== "intervaled_monthly") return ["Settled per transaction"];
	return [
		{ text: `Issued on the ${billingDayOrdinal(view.billingDay ?? 1)}`, tabular: true },
		...(view.nextInvoiceLabel ? [{ text: view.nextInvoiceLabel, tabular: true }] : []),
		...(view.onAccount
			? [{
				text: `${view.onAccount.owedLabel} owed on account of ${view.onAccount.limitLabel}`,
				tabular: true,
			}]
			: []),
	];
}

/** The Statements band's meta: statements stay on the 1st whatever the billing day (Decision #168). */
export const STATEMENTS_META: readonly MetaLineEntry[] = [{
	text: "Issued on the 1st",
	tabular: true,
}];
// #endregion

// #region Commits — one amber per page
/** What {@link billingCommits} decides from. */
export interface BillingCommitsInput {
	/** `viewerCan.payInvoice`: the billing right, a verified business, an active one. */
	canPay: boolean;
	rows: readonly BillingInvoiceRow[];
	/** The default-currency wallet is under the floor (or the Dev Context Switcher says so). */
	belowFloor: boolean;
	/** The viewer may add money to the business wallet (`contribute_funds`). */
	canTopUp: boolean;
}

/** The page's money commits. At most one of `pay` and a tier-1 `topUp` is ever set. */
export interface BillingCommits {
	/** The oldest payable invoice — the band's tier-1 "Pay €X" — or `null`. */
	pay: BillingInvoiceRow | null;
	/** The other payable invoices, each with a tier-5 row "Pay" into the same review. */
	rowPay: ReadonlySet<string>;
	/** The balance band's Top up and its tier, or `null` when the band offers none. */
	topUp: { tier: 1 | 4 } | null;
}

/** Decide the page's commits so it holds exactly one amber control at most (Decision #247 (c)). */
export function billingCommits(input: BillingCommitsInput): BillingCommits {
	const payable = input.canPay ? payableRows(input.rows) : [];
	const pay = payable[payable.length - 1] ?? null;
	const rowPay = new Set(payable.slice(0, -1).map((row) => row.id));
	const topUp = input.belowFloor && input.canTopUp ? { tier: pay ? 4 as const : 1 as const } : null;
	return { pay, rowPay, topUp };
}

/**
 * The business wallet's top-up, returning to this business's Billing module when done (the wallet
 * intent, Decision #243; the way back allowlisted by #247).
 */
export function topUpHrefFor(businessId: string, handle: string): string {
	return walletIntentHref(
		`business:${businessId}`,
		"top_up",
		workspaceHref("business", handle, "billing"),
	);
}
// #endregion

// #region The review
/** What {@link reviewFor} needs beyond the invoice. */
export interface BillingReviewContext {
	businessName: string;
	/** The business wallet's top-up hand-off ({@link topUpHrefFor}). */
	topUpHref: string;
	canTopUp: boolean;
	/**
	 * The currency that top-up adds — the business's billing currency, its wallet's primary one. An
	 * invoice in another currency is not cleared by it, so its review offers no top-up.
	 */
	currency: string;
	/**
	 * A Pay was refused for a reason a retry cannot clear (an inactive business, KYB, the billing right
	 * gone — {@link payRefusalIsFinal}): the review offers no commit, only Close.
	 */
	blocked?: boolean;
}

/** One invoice's review step, as {@link CommitReview} takes it. */
export interface BillingReview {
	title: string;
	/** The amount the commit moves, or `null` when nothing is due. */
	total: string | null;
	rows: CommitReviewRow[];
	consequence: string;
	/** `action` pays in place; `link` hands off to the top-up; `none` offers no commit. */
	mode: "action" | "link" | "none";
	commitLabel: string | null;
	/** The amount after the commit's verb ("Pay" · "US$640.00"), set as a figure. */
	commitFigure: string | null;
	commitHref: string | null;
}

/**
 * The review before an invoice is paid: the amount, the wallet it leaves, the balance now and after.
 * A wallet that holds less than is due shows how much it is short by, and the commit becomes the
 * top-up (for someone who may add money, in the currency a top-up adds) — or no commit, with whom to
 * ask. An invoice with nothing left to pay (someone else paid it while the review was open) offers no
 * commit at all.
 */
export function reviewFor(row: BillingInvoiceRow, ctx: BillingReviewContext): BillingReview {
	const wallet = `${possessive(ctx.businessName)} wallet`;
	if (!isPayable(row)) {
		return {
			title: "Pay this invoice",
			total: null,
			rows: [
				{ label: "Invoice", value: row.periodLabel },
				{ label: "Status", value: row.dueLabel, tabular: true },
			],
			consequence: "Nothing is due on this invoice now.",
			mode: "none",
			commitLabel: null,
			commitFigure: null,
			commitHref: null,
		};
	}
	const head: CommitReviewRow[] = [
		{ label: "Invoice", value: row.periodLabel },
		{ label: "From", value: wallet },
		{ label: "Balance now", value: row.walletBalanceLabel, tabular: true },
	];
	if (ctx.blocked) {
		// The refusal itself is said inside the review; nothing here offers the same Pay again.
		return {
			title: "Pay this invoice",
			total: row.amountDueLabel,
			rows: head,
			consequence: "Nothing was paid.",
			mode: "none",
			commitLabel: null,
			commitFigure: null,
			commitHref: null,
		};
	}
	if (row.covered && row.balanceAfterLabel !== null) {
		return {
			title: "Pay this invoice",
			total: row.amountDueLabel,
			rows: [...head, { label: "Balance after", value: row.balanceAfterLabel, tabular: true }],
			consequence:
				"The amount leaves the wallet straight away and the invoice is marked paid. This can't be reversed.",
			mode: "action",
			commitLabel: "Pay",
			commitFigure: row.amountDueLabel,
			commitHref: null,
		};
	}
	const short: CommitReviewRow[] = row.shortfallLabel
		? [...head, { label: "Short by", value: row.shortfallLabel, tabular: true }]
		: head;
	if (ctx.canTopUp && row.currency.toUpperCase() !== ctx.currency.toUpperCase()) {
		return {
			title: "Pay this invoice",
			total: row.amountDueLabel,
			rows: short,
			consequence:
				`The wallet holds less ${row.currency.toUpperCase()} than this invoice, and a top-up adds ${ctx.currency.toUpperCase()}, so it can't cover this one.`,
			mode: "none",
			commitLabel: null,
			commitFigure: null,
			commitHref: null,
		};
	}
	if (ctx.canTopUp) {
		return {
			title: "Pay this invoice",
			total: row.amountDueLabel,
			rows: short,
			consequence:
				"The wallet holds less than this invoice. Top it up first; you come back here to pay.",
			mode: "link",
			commitLabel: "Top up the wallet",
			commitFigure: null,
			commitHref: ctx.topUpHref,
		};
	}
	return {
		title: "Pay this invoice",
		total: row.amountDueLabel,
		rows: short,
		consequence: `The wallet holds less than this invoice. ${
			BUSINESS_REFUSAL_COPY.pool_short.ask({})
		}`,
		mode: "none",
		commitLabel: null,
		commitFigure: null,
		commitHref: null,
	};
}
// #endregion

// #region Refusals
/** The refusal codes a billing write can come back with that the business refusal map words. */
const MAPPED_REFUSALS = ["business_not_active", "kyb_required", "entitlement"] as const;

/**
 * What a refused billing write (a save or a Pay) says: the business refusal map's sentence when the
 * server named one of its codes in `details.reason` (Decision #243 — one refusal reads as one
 * sentence wherever it is met), else the server's own sentence, else `fallback`.
 */
export function billingRefusalSentence(
	res: { message?: string; details?: Record<string, unknown> },
	ctx: { business: string; kybStatus?: string | null },
	fallback: string,
): string {
	const reason = res.details?.reason;
	const mapped = MAPPED_REFUSALS.find((code) => code === reason);
	if (mapped) {
		return BUSINESS_REFUSAL_COPY[mapped].sentence({
			business: ctx.business,
			kybStatus: ctx.kybStatus ?? null,
		});
	}
	return res.message ?? fallback;
}

/** The refusal codes after which the same Pay is refused again, however often it is pressed. */
const FINAL_REASONS: readonly string[] = ["business_not_active", "kyb_required"];

/**
 * Whether a refused Pay is final for this page: the business went inactive or is not KYB-verified, or
 * the re-read view says the viewer can no longer pay (`can_pay` — the billing right gone, or either of
 * those). A retry would be refused the same way, so the review offers Close, not "Try again", and the
 * page's Pay controls go. A wallet that ran short, an invoice someone else paid and a refusal the
 * server could not explain stay retryable: the re-read view re-reviews those.
 */
export function payRefusalIsFinal(
	res: { details?: Record<string, unknown>; data?: { canPay: boolean } | null },
): boolean {
	const reason = res.details?.reason;
	if (typeof reason === "string" && FINAL_REASONS.includes(reason)) return true;
	return res.data ? !res.data.canPay : false;
}
// #endregion

// #region Gates
/** What {@link billingGate} decides from. */
export interface BillingGateInput {
	status: WorkspaceStatus;
	/** The business's KYB picture (BB9), or `null` before it is read. */
	kyb: BusinessKyb | null;
	/** The detail's verification state, when `kyb` is absent. */
	verification: VerificationState;
	/** The viewer owns the business — Restore is the owner's. */
	isOwner: boolean;
	/** The viewer may publish a draft (`manage_settings`) — from the business's Overview. */
	canPublish?: boolean;
	name: string;
	handle: string;
}

/** Why Pay is not offered, and the way forward — or `null` when nothing stands in the way. */
export interface BillingGate {
	/** `refused`: a Pay on this page was refused for good ({@link refusalGate}). */
	kind: "draft" | "archived" | "kyb" | "refused";
	sentence: string;
	/** A tier-4 link to where it is cleared, or `null` when no working surface clears it yet. */
	action: { label: string; href: string } | null;
}

/**
 * Why this business cannot pay its invoices, in the database's order (an inactive business is refused
 * before KYB). A draft business is published from its Overview (Decision #248), so a viewer who may
 * publish is linked there and anyone else is given the fact alone; an archived one is restored by its
 * owner from the archived roster; KYB links to Verification, which the billing right always opens
 * (Decision #230 (d)).
 */
export function billingGate(input: BillingGateInput): BillingGate | null {
	const business = input.name;
	if (input.status !== "active") {
		const sentence = BUSINESS_REFUSAL_COPY.business_not_active.sentence({ business });
		if (input.status === "archived") {
			return {
				kind: "archived",
				sentence,
				action: input.isOwner
					? { label: "See archived businesses", href: "/businesses?tab=archived" }
					: null,
			};
		}
		return {
			kind: "draft",
			sentence,
			action: input.canPublish
				? { label: "Publish from the Overview", href: workspaceHref("business", input.handle) }
				: null,
		};
	}
	const state = input.kyb?.status ?? input.verification;
	if (state === "verified") return null;
	const due = input.kyb?.requirementsDue ?? [];
	const kybStatus = due.includes("kyb_rejected")
		? "rejected"
		: due.includes("kyb_expired")
		? "expired"
		: state;
	const copy = BUSINESS_REFUSAL_COPY.kyb_required;
	return {
		kind: "kyb",
		sentence: copy.sentence({ business, kybStatus }),
		action: copy.action
			? {
				label: copy.action({ business, kybStatus }),
				href: workspaceHref("business", input.handle, "verification"),
			}
			: null,
	};
}

/**
 * The page's gate after a final Pay refusal ({@link payRefusalIsFinal}) — the page was read before the
 * business went inactive, lost its KYB or the viewer lost the billing right. It says the refusal's own
 * sentence (the one the review said), with the way to Verification for KYB, so the page explains why
 * its Pay controls went.
 */
export function refusalGate(
	reason: unknown,
	sentence: string,
	ctx: { business: string; handle: string; kybStatus?: string | null },
): BillingGate {
	const copy = BUSINESS_REFUSAL_COPY.kyb_required;
	if (reason === "kyb_required" && copy.action) {
		return {
			kind: "kyb",
			sentence,
			action: {
				label: copy.action({ business: ctx.business, kybStatus: ctx.kybStatus ?? null }),
				href: workspaceHref("business", ctx.handle, "verification"),
			},
		};
	}
	return { kind: reason === "kyb_required" ? "kyb" : "refused", sentence, action: null };
}
// #endregion

// #region Terms
/** What {@link termsAvailability} decides from. */
export interface TermsInput {
	status: WorkspaceStatus;
	kybVerified: boolean;
	planAllowsMonthly: boolean;
	/** The STORED invoicing mode — re-selecting it is a revert, never refused. */
	mode: InvoicingMode;
	/** The viewer holds the billing right. */
	canEdit: boolean;
	/**
	 * The surface's Save renders for this viewer. The footer rig's Save needs `manage_finances`
	 * (Decision #247 (i)), so without it the form is read-only rather than editable with nothing to
	 * commit it (§3.11). Default `true`.
	 */
	canSave?: boolean;
}

/** Why the terms form is read-only, as the Billing band's meta says it — or `null` when it is open. */
export function termsReadOnlyReason(canEdit: boolean, canSave: boolean): string | null {
	if (!canEdit) return "Only members who manage billing can change these";
	if (!canSave) return "Saving these also needs the right to manage finances";
	return null;
}

/** Which invoicing controls are open, and why not. */
export interface TermsAvailability {
	/** The whole invoicing switch is closed. */
	modeDisabled: boolean;
	/** Monthly cannot be chosen (it is not the stored mode, and the plan or KYB refuses it). */
	monthlyOptionDisabled: boolean;
	/** The billing day cannot change (it is a monthly change, which the plan or KYB refuses). */
	dayDisabled: boolean;
	/** `entitlement` — the Business Pro notice renders under the switch. */
	notice: "entitlement" | null;
	/** The switch's hint. */
	hint: string;
}

/** Said wherever a business on monthly invoicing could leave it for good (Decision #247 (j)). */
export const ONE_WAY = "Switching to per transaction can't be undone without Business Pro.";

const MONTHLY_HINT =
	"A monthly invoice lists the month's released escrow, fees and anything bought on account.";

/**
 * The invoicing terms' availability, in `finance.set_invoicing_terms`'s own order: an active business,
 * then the Business Pro gate (`intervaled_invoicing`), then KYB. Going back to per transaction is never
 * gated; auto-funding and the floor are not terms and stay open (`set_billing_controls`).
 */
export function termsAvailability(input: TermsInput): TermsAvailability {
	const stored = input.mode === "intervaled_monthly";
	if (!input.canEdit) {
		return {
			modeDisabled: true,
			monthlyOptionDisabled: true,
			dayDisabled: true,
			notice: null,
			hint: "Only members who manage billing can change these.",
		};
	}
	if (input.canSave === false) {
		return {
			modeDisabled: true,
			monthlyOptionDisabled: true,
			dayDisabled: true,
			notice: null,
			hint: "Saving these also needs the right to manage finances.",
		};
	}
	if (input.status !== "active") {
		return {
			modeDisabled: true,
			monthlyOptionDisabled: true,
			dayDisabled: true,
			notice: null,
			hint: "Invoicing terms can change once the business is active.",
		};
	}
	if (!input.planAllowsMonthly) {
		return {
			modeDisabled: false,
			monthlyOptionDisabled: !stored,
			dayDisabled: true,
			notice: "entitlement",
			hint: stored
				? `Monthly invoicing carries on as it is; its billing day changes only on Business Pro. ${ONE_WAY}`
				: MONTHLY_HINT,
		};
	}
	if (!input.kybVerified) {
		return {
			modeDisabled: false,
			monthlyOptionDisabled: !stored,
			dayDisabled: true,
			notice: null,
			hint: "Monthly invoicing needs business verification.",
		};
	}
	return {
		modeDisabled: false,
		monthlyOptionDisabled: false,
		dayDisabled: false,
		notice: null,
		hint: MONTHLY_HINT,
	};
}
// #endregion
