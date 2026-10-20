import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Button, FormControl, MoneyInput, Select, SelectButton } from "@projective/ui/fields";
import { type DataColumn, DataTable, MetaLine } from "@projective/ui/display";
import { CommitReview, InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { MenuItem } from "@ui/types/mod.ts";
import type {
	AutoFundMode,
	BillingInvoiceRow,
	BillingStatementRow,
	BusinessBillingView,
	InvoicingMode,
} from "@projective/types/finance";
import type { WorkspaceDetail } from "@projective/types/workspace";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { saveState } from "../core/workspace-state.ts";
import { usePolicyBridge } from "../hooks/usePolicyBridge.ts";
import { BUSINESS_REFUSAL_COPY } from "../core/refusal-copy.ts";
import {
	billingCommits,
	billingDayOptions,
	type BillingGate,
	billingGate,
	billingRefusalSentence,
	invoicesMeta,
	payRefusalIsFinal,
	refusalGate,
	reviewFor,
	STATEMENTS_META,
	termsAvailability,
	termsReadOnlyReason,
	topUpHrefFor,
} from "../core/billing-model.ts";

/**
 * BillingScreen — the business console's Billing module (PRODUCT_SPEC §Escrow, Wallets & Finance #4;
 * BU3, Decision #247).
 *
 * In the order the questions arrive: is anything owed (the invoices), what happened to the money
 * (statement PDFs), and how billing should behave (invoicing terms, auto-funding, the balance floor).
 * It renders the server's projection and never computes money; what it offers is decided by the pure
 * `billing-model.ts`:
 *
 *  - **One amber control per page.** The oldest payable invoice gets the band's tier-1 "Pay €X";
 *    every other payable row a tier-5 "Pay"; both open the same {@link CommitReview} — the amount, the
 *    wallet it leaves, the balance now and after — and money moves only from its commit. Pay renders
 *    only for `viewerCan.payInvoice` (the billing right, a verified, active business).
 *  - **Below the floor**, the balance band's Top up hands off to the business wallet's top-up and
 *    back (`/wallet?w=business:<id>&do=top_up&back=…`). It is tier 1 while no Pay renders, tier 4
 *    beside one.
 *  - **Gates** (draft · archived · KYB) are the refusal map's sentences with at most one tier-4 link,
 *    to a surface that clears them.
 *  - **Terms** are FormControls; monthly invoicing under the Business Pro gate says so before the
 *    Save. Save and Discard are the footer band's, answered here through `usePolicyBridge`, so
 *    there is one Save on the surface.
 *
 * The Dev Context Switcher's `autoFundMode` previews the mode sentence, `lowBalance` the floor warning
 * and `businessPlanGates` the Business Pro read (through the server); none changes what is stored.
 */

export interface BillingScreenProps {
	workspace: WorkspaceDetail;
	billing: BusinessBillingView;
}

const AUTO_FUND_OPTIONS: { label: string; value: AutoFundMode }[] = [
	{ label: "Off", value: "off" },
	{ label: "Add to basket", value: "add_to_basket" },
	{ label: "From wallet", value: "from_wallet" },
];

/** The auto-funding hint's second sentence. */
const PROJECT_OVERRIDES = "A project can override this in its details.";

/** What each mode does, in one sentence. */
const AUTO_FUND_SENTENCE: Record<AutoFundMode, string> = {
	off: "When a ticket can't start for want of money, the project owner is told and funds it by hand.",
	add_to_basket: "When a ticket can't start for want of money, it is added to the business basket, ready to pay.",
	from_wallet:
		"When a ticket can't start for want of money, it is queued and funded from the wallet as soon as the wallet covers it — inside each owner's spending limit, with approvals above the threshold.",
};

const STATUS_SEVERITY = { issued: "info", overdue: "danger", paid: "success", draft: "secondary", void: "secondary" } as const;
const STATUS_LABEL = { issued: "Due", overdue: "Overdue", paid: "Paid", draft: "Draft", void: "Void" } as const;

// #region Tables
/** A money figure in a cell: the table's own tabular class, isolated left-to-right (§A Figures). */
function figure(text: string): JSX.Element {
	return <span class="ui-dt__num wsp-billing__num">{text}</span>;
}

/** The PDF link, a plain anchor (the row is not a link, so nothing nests). */
function pdfLink(href: string, period: string): JSX.Element {
	return (
		<a
			class="wsp-moneyhead__link"
			href={href}
			download
			aria-label={`Download the PDF for ${period}`}
		>
			PDF
		</a>
	);
}

/**
 * The invoice columns. Period, amount due and Pay never hide; issued, due, status and PDF give way
 * first on a narrow table (the PDF stays in the row menu), so a phone's 358 px holds period · amount ·
 * Pay · the kebab. Rebuilt only when which rows carry a row Pay changes.
 */
function invoiceColumns(
	rowPay: ReadonlySet<string>,
	onPay: (row: BillingInvoiceRow) => void,
): DataColumn<BillingInvoiceRow>[] {
	const columns: DataColumn<BillingInvoiceRow>[] = [
		{
			id: "period",
			header: "Period",
			type: "text",
			value: (r) => r.periodLabel,
			// The due state rides under the period, so it survives the Due and Status columns hiding.
			secondary: (r) => r.dueLabel,
			fill: true,
			minWidth: 124,
			pinned: true,
		},
		{
			id: "issued",
			header: "Issued",
			type: "custom",
			render: (r) =>
				r.issuedAt ? <time class="ui-dt__num" dateTime={r.issuedAt}>{r.issuedLabel}</time> : null,
			sortValue: (r) => (r.issuedAt ? Date.parse(r.issuedAt) : 0),
			width: 104,
			priority: 1,
		},
		{
			id: "due",
			header: "Due",
			type: "custom",
			render: (r) => (r.dueDateLabel === "—" ? null : figure(r.dueDateLabel)),
			sortKey: null,
			width: 104,
			priority: 2,
		},
		{
			id: "amount",
			header: "Amount due",
			type: "custom",
			render: (r) => figure(r.amountDueMinor > 0 ? r.amountDueLabel : "—"),
			// Unsorted, so the header spends no room on a sort mark: "Amount due" reads whole in 112 px.
			sortKey: null,
			align: "end",
			width: 112,
		},
		{
			id: "status",
			header: "Status",
			type: "status",
			value: (r) => ({ label: STATUS_LABEL[r.status], tone: STATUS_SEVERITY[r.status] }),
			width: 112,
			priority: 3,
		},
		{
			id: "pdf",
			header: "PDF",
			type: "custom",
			render: (r) => pdfLink(r.pdfHref, r.periodLabel),
			sortKey: null,
			width: 72,
			priority: 4,
		},
	];
	if (rowPay.size === 0) return columns;
	return [
		...columns,
		{
			id: "pay",
			header: "Pay",
			headerHidden: true,
			type: "custom",
			render: (r) =>
				rowPay.has(r.id)
					? (
						<Button
							variant="text"
							size="sm"
							label="Pay"
							aria-label={`Pay ${r.amountDueLabel} for ${r.periodLabel}`}
							onClick={() => onPay(r)}
						/>
					)
					// An action cell without an action stays empty, never the table's "–" (read as a missing
					// value): the oldest invoice's Pay is the band's, and a settled row has none.
					: "",
			sortKey: null,
			width: 64,
		},
	];
}

const STATEMENT_COLUMNS: DataColumn<BillingStatementRow>[] = [
	{
		id: "period",
		header: "Period",
		type: "text",
		value: (r) => r.periodLabel,
		fill: true,
		minWidth: 140,
		pinned: true,
	},
	{
		id: "closing",
		header: "Closing balance",
		type: "custom",
		render: (r) => figure(r.closingLabel),
		sortKey: null,
		align: "end",
		width: 152,
	},
	{
		id: "pdf",
		header: "PDF",
		type: "custom",
		render: (r) => pdfLink(r.pdfHref, r.periodLabel),
		sortKey: null,
		width: 72,
		priority: 1,
	},
];

/** A row's menu: the PDF, reachable when its column has given way. */
function pdfMenu(row: { pdfHref: string }): MenuItem[] {
	return [{ label: "Download PDF", icon: "download", url: row.pdfHref }];
}
// #endregion

/** The anchor classes of the balance band's Top up: the amber pill (tier 1) or neutral outlined (tier 4). */
function topUpClass(tier: 1 | 4): string {
	return tier === 1
		? "ui-button ui-button--accent ui-button--filled ui-button--size-md ui-button--rounded wsp-billing__action"
		: "ui-button ui-button--neutral ui-button--outlined ui-button--size-md wsp-billing__action";
}

export default function BillingScreen(props: BillingScreenProps): JSX.Element {
	const ws = props.workspace;
	const view = useSignal<BusinessBillingView>(props.billing);
	const currency = view.value.currency;
	const canEdit = view.value.canManage;
	// The footer rig's Save renders for `manage_finances` (Decision #247 (i)): without it the terms are
	// read-only here, never editable with nothing to commit them.
	const canSave = ws.viewerCapabilities.includes("manage_finances");
	const formOpen = canEdit && canSave;
	const readOnly = termsReadOnlyReason(canEdit, canSave);

	// The form's drafts. Each control is bound to its Signal itself (never `.value`), so an adopted
	// server view reaches the control after a save.
	const mode = useSignal<InvoicingMode>(props.billing.invoicingMode);
	const day = useSignal<string>(String(props.billing.billingDay ?? 1));
	const autoFund = useSignal<AutoFundMode>(props.billing.autoFundMode);
	const floor = useSignal<number | null>(props.billing.lowBalanceFloorMinor);
	const error = useSignal<string | null>(null);
	const notice = useSignal<string | null>(null);
	/** The invoice under review, kept after the review closes so its exit renders the same facts. */
	const reviewing = useSignal<BillingInvoiceRow | null>(null);
	const reviewOpen = useSignal(false);
	/** Set by a Pay refused for good: the page's Pay controls go and this gate says why. */
	const payBlock = useSignal<BillingGate | null>(null);
	/** Set by a payment that closed the review: focus then goes to the Invoices heading (below). */
	const paidFocus = useSignal(false);
	const invoicesHead = useRef<HTMLHeadingElement>(null);

	const seam = readDevSeam();
	const forcedAutoFund = useSignal(seam?.autoFundMode);
	const forcedLow = useSignal(seam?.lowBalance);
	useEffect(() =>
		subscribeDevSeam((s) => {
			forcedAutoFund.value = s?.autoFundMode;
			forcedLow.value = s?.lowBalance;
		}), []);

	const storedDay = useComputed(() => view.value.billingDay ?? 1);
	const dirty = useComputed(() =>
		mode.value !== view.value.invoicingMode ||
		(mode.value === "intervaled_monthly" && Number(day.value) !== storedDay.value) ||
		autoFund.value !== view.value.autoFundMode ||
		floor.value !== view.value.lowBalanceFloorMinor
	);
	function adopt(next: BusinessBillingView): void {
		view.value = next;
		mode.value = next.invoicingMode;
		day.value = String(next.billingDay ?? 1);
		autoFund.value = next.autoFundMode;
		floor.value = next.lowBalanceFloorMinor;
	}

	async function save(): Promise<void> {
		if (!dirty.value) return;
		saveState.value = "saving";
		error.value = null;
		const v = view.value;
		const billingDay = Number(day.value);
		const res = await WorkspaceService.updateBilling({
			businessId: v.businessId,
			...(mode.value !== v.invoicingMode ? { invoicingMode: mode.value } : {}),
			...(mode.value === "intervaled_monthly" && billingDay !== storedDay.value
				? { invoicingMode: mode.value, billingDay }
				: {}),
			...(autoFund.value !== v.autoFundMode ? { autoFundMode: autoFund.value } : {}),
			...(floor.value !== v.lowBalanceFloorMinor ? { lowBalanceFloorMinor: floor.value } : {}),
		});
		if (!res.ok || !res.data) {
			saveState.value = "error";
			error.value = billingRefusalSentence(res, refusalCtx(), "Could not save billing.");
			return;
		}
		saveState.value = "saved";
		adopt(res.data);
	}

	/*
	 * The footer band's Save and Discard are pulses, not callbacks (`usePolicyBridge`): only a NEW pulse
	 * acts — one left over from another module's editor does not fire on mount — and the handler runs
	 * untracked, so the bridge never subscribes to the form (else every keystroke would save). Discard
	 * re-adopts the saved view.
	 */
	usePolicyBridge({
		dirty,
		save,
		discard: () => {
			adopt(view.value);
			error.value = null;
		},
	});

	/** Open the review for an invoice. Money moves only from the review's commit. */
	function openReview(row: BillingInvoiceRow): void {
		reviewing.value = row;
		notice.value = null;
		reviewOpen.value = true;
	}

	/** What a refusal sentence may name: the business, and its KYB state for `kyb_required`. */
	function refusalCtx(): { business: string; kybStatus: string | null } {
		return { business: ws.name, kybStatus: ws.kyb?.status ?? null };
	}

	/**
	 * The review's commit: pay the invoice's amount due from the business wallet. Resolves `null` when
	 * it went through (the review closes) or the refusal's sentence (the review says it). Only the view
	 * is adopted — unsaved terms stay as they are.
	 *
	 * A refusal carries what is true now when the server could read it: the view is adopted and the
	 * invoice re-reviewed from it, so a wallet drained since the page loaded turns the commit into the
	 * top-up, and an invoice someone else paid offers no commit. A refusal a retry cannot clear (the
	 * business went inactive, KYB, the billing right gone — `payRefusalIsFinal`) leaves the review with
	 * Close only and takes the page's Pay controls away behind a gate saying why — never the same
	 * refused Pay again. A payment whose re-read failed still went through: it closes the review and
	 * says so.
	 */
	async function pay(row: BillingInvoiceRow): Promise<string | null> {
		const res = await WorkspaceService.payInvoice(row.id);
		if (!res.ok) {
			const sentence = billingRefusalSentence(res, refusalCtx(), "Could not pay that invoice.");
			if (res.data) {
				view.value = res.data;
				reviewing.value = res.data.invoices.find((r) => r.id === row.id) ?? reviewing.value;
			}
			if (payRefusalIsFinal(res)) {
				payBlock.value = refusalGate(res.details?.reason, sentence, {
					business: ws.name,
					handle: ws.handle,
					kybStatus: ws.kyb?.status ?? null,
				});
			}
			return sentence;
		}
		if (res.data) view.value = res.data;
		notice.value = res.data
			? `Paid ${row.amountDueLabel} from the wallet.`
			: `Paid ${row.amountDueLabel} from the wallet. Reload the page to see the new balance.`;
		paidFocus.value = true;
		return null;
	}

	/*
	 * A payment hands focus to the Invoices heading. The review closes and, as a rule, the Pay that
	 * opened it moves to the next invoice or leaves, so the dialog's restore can land on `<body>`.
	 * Claimed once the review has left the DOM (its trap holds focus until then), and only while focus
	 * is on `<body>`.
	 */
	useEffect(() => {
		if (!paidFocus.value || reviewOpen.value) return;
		let tries = 0;
		const claim = () => {
			if (document.querySelector(".ui-commit-review")) return false;
			const active = document.activeElement;
			if (active === null || active === document.body) invoicesHead.current?.focus();
			return true;
		};
		const done = () => {
			paidFocus.value = false;
		};
		if (claim()) return done();
		const id = setInterval(() => {
			if (claim() || ++tries > 30) {
				clearInterval(id);
				done();
			}
		}, 50);
		return () => clearInterval(id);
	}, [paidFocus.value, reviewOpen.value]);

	const shownMode: AutoFundMode = forcedAutoFund.value && forcedAutoFund.value !== "auto"
		? forcedAutoFund.value
		: autoFund.value;
	const belowFloor = forcedLow.value === "below" ? true : forcedLow.value === "above" ? false : view.value.belowFloor;
	const v = view.value;
	const autoFundHint = `${AUTO_FUND_SENTENCE[shownMode]} ${PROJECT_OVERRIDES}`;
	const floorHint =
		`Everyone who can add funds is told once when the ${currency} wallet drops below ` +
		"this. Clear it to turn the warning off. A recurring deposit can top up whenever it does.";

	// The page's read AND the latest re-read: a refusal's re-read view (`can_pay`) takes Pay away.
	const canPay = ws.viewerCan?.payInvoice === true && v.canPay && payBlock.value === null;
	const canTopUp = ws.viewerCapabilities.includes("contribute_funds");
	const commits = billingCommits({ canPay, rows: v.invoices, belowFloor, canTopUp });
	const rowPayKey = [...commits.rowPay].join(",");
	const columns = useMemo(() => invoiceColumns(commits.rowPay, openReview), [rowPayKey]);
	const dayOptions = useMemo(billingDayOptions, []);
	const self = ws.members.find((m) => m.id === ws.viewerMemberId);
	const gate = billingGate({
		status: ws.status,
		kyb: ws.kyb,
		verification: ws.verification,
		isOwner: self?.rolePreset === "owner",
		canPublish: ws.viewerCapabilities.includes("manage_settings"),
		name: ws.name,
		handle: ws.handle,
	}) ?? payBlock.value;
	const topUpHref = topUpHrefFor(ws.id, ws.handle);
	const terms = termsAvailability({
		status: ws.status,
		kybVerified: v.kybVerified,
		planAllowsMonthly: v.planAllowsMonthly,
		mode: v.invoicingMode,
		canEdit,
		canSave,
	});
	const invoicingOptions = [
		{ label: "Per transaction", value: "per_transaction" },
		{
			label: "Monthly invoice",
			value: "intervaled_monthly",
			disabled: terms.monthlyOptionDisabled,
		},
	];
	const reviewRow = reviewing.value;
	const review = reviewRow
		? reviewFor(reviewRow, {
			businessName: ws.name,
			topUpHref,
			canTopUp,
			currency,
			blocked: payBlock.value !== null,
		})
		: null;

	return (
		<div class="wsp" data-kind="business">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" data-i={0}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">Billing</h1>
							<p class="wsp-pagehead__note">
								What {ws.name} owes and has paid, its wallet statements, and how billing behaves — monthly
								invoicing, auto-funding and the balance floor.
							</p>
						</div>
					</div>
				</section>

				{belowFloor && (
					<section class="wsp-band wsp-band--plain" data-i={1} aria-label="Wallet balance">
						<div class="wsp-band__inner">
							<div class="wsp-billing">
								<div class="wsp-billing__gate">
									<InlineNotice
										class="wsp-billing__notice"
										align="start"
										icon={<Icon name="warning" />}
									>
										The {currency} wallet holds{" "}
										<span class="wsp-billing__num">{v.balanceLabel}</span>, below the floor you set.
									</InlineNotice>
									{commits.topUp
										? (
											<a class={topUpClass(commits.topUp.tier)} href={topUpHref}>
												<span class="ui-button__icon">
													<Icon name="plus" />
												</span>
												<span class="ui-button__label">Top up</span>
											</a>
										)
										: <p class="wsp-billing__ask">{BUSINESS_REFUSAL_COPY.pool_short.ask({})}</p>}
								</div>
							</div>
						</div>
					</section>
				)}

				<section class="wsp-band wsp-band--money" data-i={2}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title" ref={invoicesHead} tabIndex={-1}>Invoices</h2>
							<MetaLine items={invoicesMeta(v)} />
						</div>
						<div class="wsp-band__body wsp-billing">
							{gate && (
								<div class="wsp-billing__gate" data-gate={gate.kind}>
									<InlineNotice
										class="wsp-billing__notice"
										align="start"
										icon={<Icon name={gate.kind === "kyb" ? "shield" : "info"} />}
										text={gate.sentence}
									/>
									{gate.action && (
										<a
											class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm wsp-billing__action"
											href={gate.action.href}
										>
											<span class="ui-button__label">{gate.action.label}</span>
										</a>
									)}
								</div>
							)}

							{commits.pay && (
								<div class="wsp-billing__next">
									<div class="wsp-billing__next-facts" id="wsp-billing-next">
										<p class="wsp-billing__next-title">{commits.pay.periodLabel}</p>
										<MetaLine
											items={[
												commits.rowPay.size > 0 ? "Oldest unpaid invoice" : "Unpaid invoice",
												{ text: commits.pay.dueLabel, tabular: true },
											]}
										/>
									</div>
									<Button
										severity="accent"
										variant="filled"
										rounded
										aria-describedby="wsp-billing-next"
										onClick={() => openReview(commits.pay!)}
									>
										Pay <span class="wsp-billing__num">{commits.pay.amountDueLabel}</span>
									</Button>
								</div>
							)}

							{v.invoices.length === 0
								? (
									<p class="wsp-pagehead__meta">
										{v.invoicingMode === "intervaled_monthly"
											? "No invoices yet — the first is issued on the next billing day."
											: "On per-transaction billing each purchase is settled as it happens, so there is no monthly invoice."}
									</p>
								)
								: (
									<DataTable
										rows={v.invoices}
										rowKey={(r) => r.id}
										rowLabel={(r) => r.periodLabel}
										columns={columns}
										aria-label={`Invoices for ${ws.name}`}
										multiSort={false}
										rowActions={pdfMenu}
										virtualize={false}
										columnChooser={false}
									/>
								)}
							{notice.value && (
								<InlineNotice
									class="wsp-billing__notice"
									align="start"
									icon={<Icon name="check" />}
									text={notice.value}
								/>
							)}
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--ledger" data-i={3}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">Statements</h2>
							{/* Wallet statements stay on the 1st whatever the billing day (Decision #168). */}
							<MetaLine items={STATEMENTS_META} />
						</div>
						<div class="wsp-band__body">
							{v.statements.length === 0
								? <p class="wsp-pagehead__meta">No statements yet — the first arrives on the 1st of next month.</p>
								: (
									<DataTable
										rows={v.statements}
										rowKey={(r) => r.id}
										rowLabel={(r) => r.periodLabel}
										columns={STATEMENT_COLUMNS}
										aria-label={`Wallet statements for ${ws.name}`}
										multiSort={false}
										rowActions={pdfMenu}
										virtualize={false}
										columnChooser={false}
									/>
								)}
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--money wsp-band--tail" data-i={4}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">How billing works</h2>
							{readOnly && <MetaLine items={[readOnly]} />}
						</div>
						<div class="wsp-band__body wsp-billing">
							<div class="wsp-billing__settings">
								<FormControl label="Invoicing" hint={terms.hint} hintMode="inline">
									{({ id, describedBy }) => (
										<div class="wsp-billing__stack">
											<SelectButton
												id={id}
												options={invoicingOptions}
												value={mode}
												onValueChange={() => {
													error.value = null;
												}}
												disabled={terms.modeDisabled}
												aria-label="Invoicing"
												aria-describedby={describedBy}
											/>
											{terms.notice === "entitlement" && (
												// "See plans" is withheld: no surface lists Business Pro yet (Decision #247 (d)).
												<InlineNotice
													class="wsp-billing__notice"
													align="start"
													icon={<Icon name="lock" />}
													text={BUSINESS_REFUSAL_COPY.entitlement.sentence({ business: ws.name })}
												/>
											)}
										</div>
									)}
								</FormControl>

								{mode.value === "intervaled_monthly" && (
									<FormControl
										label="Billing day"
										hint="The day of the month the invoice is issued."
									>
										{({ id, describedBy }) => (
											<Select
												id={id}
												options={dayOptions}
												value={day}
												onValueChange={() => {
													error.value = null;
												}}
												disabled={terms.dayDisabled}
												aria-describedby={describedBy}
												fluid
											/>
										)}
									</FormControl>
								)}

								<FormControl label="Auto-funding" hint={autoFundHint}>
									{({ id, describedBy }) => (
										<SelectButton
											id={id}
											options={AUTO_FUND_OPTIONS}
											value={autoFund}
											onValueChange={() => {
												error.value = null;
											}}
											disabled={!formOpen}
											aria-label="Auto-funding"
											aria-describedby={describedBy}
										/>
									)}
								</FormControl>

								<FormControl label="Balance floor" hint={floorHint}>
									{({ id, describedBy }) => (
										<MoneyInput
											id={id}
											value={floor}
											currency={currency}
											onValueChange={(minor) => {
												error.value = null;
												// Nothing (or nothing above zero) is no floor.
												if (minor === null || minor <= 0) floor.value = null;
											}}
											disabled={!formOpen}
											aria-describedby={describedBy}
											fluid
										/>
									)}
								</FormControl>
							</div>
							{error.value && (
								<InlineNotice
									class="wsp-billing__notice"
									align="start"
									assertive
									icon={<Icon name="warning" />}
									text={error.value}
								/>
							)}
						</div>
					</div>
				</section>
			</div>

			{review && (
				<CommitReview
					visible={reviewOpen}
					title={review.title}
					total={review.total}
					rows={review.rows}
					consequence={review.consequence}
					commitLabel={review.commitLabel ?? undefined}
					commitFigure={review.commitFigure}
					onCommit={review.mode === "action" && reviewRow ? () => pay(reviewRow) : undefined}
					commitHref={review.mode === "link" ? review.commitHref : null}
				/>
			)}
		</div>
	);
}
