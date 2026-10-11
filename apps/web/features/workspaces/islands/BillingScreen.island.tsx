import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import { Button, InputNumber, Select, SelectButton } from "@projective/ui/fields";
import { Tag } from "@projective/ui/display";
import { styleVars } from "@ui/core/style.ts";
import {
	type AutoFundMode,
	type BillingInvoiceRow,
	type BusinessBillingView,
	type InvoicingMode,
	toMajorUnits,
	toMinorUnits,
} from "@projective/types/finance";
import { walletHrefFor, type WorkspaceDetail, workspaceHref } from "@projective/types/workspace";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { policyDirty, saveRequested, saveState } from "../core/workspace-state.ts";

/**
 * BillingScreen — the business console's Billing module (PRODUCT_SPEC §Escrow, Wallets & Finance #4).
 *
 * In the order the questions arrive: is anything owed (the invoices, each with Pay when an amount is
 * due), what happened to the money (statement PDFs), and how billing should behave (invoicing terms,
 * auto-funding, the balance floor). It renders the server's projection and never computes money;
 * Save is the footer band's, watched here as a pulse, so there is one Save on the surface.
 *
 * The Dev Context Switcher's `autoFundMode` previews the mode sentence and `lowBalance` the floor
 * warning; neither changes what is stored.
 */

export interface BillingScreenProps {
	workspace: WorkspaceDetail;
	billing: BusinessBillingView;
}

const INVOICING_OPTIONS = [
	{ label: "Per transaction", value: "per_transaction" },
	{ label: "Monthly invoice", value: "intervaled_monthly" },
];

const AUTO_FUND_OPTIONS: { label: string; value: AutoFundMode }[] = [
	{ label: "Off — fund each ticket by hand", value: "off" },
	{ label: "Add to basket", value: "add_to_basket" },
	{ label: "Fund from the business wallet", value: "from_wallet" },
];

/** What each mode does, in one sentence. */
const AUTO_FUND_SENTENCE: Record<AutoFundMode, string> = {
	off: "When a ticket can't start for want of money, the project owner is told and funds it by hand.",
	add_to_basket: "When a ticket can't start for want of money, it is added to the business basket, ready to pay.",
	from_wallet:
		"When a ticket can't start for want of money, it is queued and funded from the wallet as soon as the wallet covers it — inside each owner's spending limit, with approvals above the threshold.",
};

const STATUS_SEVERITY = { issued: "info", overdue: "danger", paid: "success", draft: "secondary", void: "secondary" } as const;
const STATUS_LABEL = { issued: "Due", overdue: "Overdue", paid: "Paid", draft: "Draft", void: "Void" } as const;

export default function BillingScreen(props: BillingScreenProps): JSX.Element {
	const ws = props.workspace;
	const view = useSignal<BusinessBillingView>(props.billing);
	const currency = view.value.currency;
	const canEdit = view.value.canManage;

	const mode = useSignal<InvoicingMode>(props.billing.invoicingMode);
	const day = useSignal<number>(props.billing.billingDay ?? 1);
	const autoFund = useSignal<AutoFundMode>(props.billing.autoFundMode);
	const floor = useSignal<number | null>(props.billing.lowBalanceFloorMinor);
	const payingId = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);
	const notice = useSignal<string | null>(null);

	const seam = readDevSeam();
	const forcedAutoFund = useSignal(seam?.autoFundMode);
	const forcedLow = useSignal(seam?.lowBalance);
	useEffect(() =>
		subscribeDevSeam((s) => {
			forcedAutoFund.value = s?.autoFundMode;
			forcedLow.value = s?.lowBalance;
		}), []);

	const dirty = useComputed(() =>
		mode.value !== view.value.invoicingMode ||
		(mode.value === "intervaled_monthly" && day.value !== (view.value.billingDay ?? 1)) ||
		autoFund.value !== view.value.autoFundMode ||
		floor.value !== view.value.lowBalanceFloorMinor
	);
	useEffect(() => {
		policyDirty.value = dirty.value;
		return () => {
			policyDirty.value = false;
		};
	}, [dirty.value]);

	function adopt(next: BusinessBillingView): void {
		view.value = next;
		mode.value = next.invoicingMode;
		day.value = next.billingDay ?? 1;
		autoFund.value = next.autoFundMode;
		floor.value = next.lowBalanceFloorMinor;
	}

	async function save(): Promise<void> {
		if (!dirty.value) return;
		saveState.value = "saving";
		error.value = null;
		const res = await WorkspaceService.updateBilling({
			businessId: view.value.businessId,
			...(mode.value !== view.value.invoicingMode ? { invoicingMode: mode.value } : {}),
			...(mode.value === "intervaled_monthly" && day.value !== (view.value.billingDay ?? 1)
				? { invoicingMode: mode.value, billingDay: day.value }
				: {}),
			...(autoFund.value !== view.value.autoFundMode ? { autoFundMode: autoFund.value } : {}),
			...(floor.value !== view.value.lowBalanceFloorMinor ? { lowBalanceFloorMinor: floor.value } : {}),
		});
		if (!res.ok || !res.data) {
			saveState.value = "error";
			error.value = res.message ?? "Could not save billing.";
			return;
		}
		saveState.value = "saved";
		adopt(res.data);
	}

	useEffect(() => {
		if (saveRequested.value > 0) void save();
	}, [saveRequested.value]);

	async function pay(row: BillingInvoiceRow): Promise<void> {
		payingId.value = row.id;
		error.value = null;
		notice.value = null;
		const res = await WorkspaceService.payInvoice(row.id);
		payingId.value = null;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not pay that invoice.";
			return;
		}
		notice.value = `Paid ${row.amountDueLabel} from the wallet.`;
		adopt(res.data);
	}

	const shownMode: AutoFundMode = forcedAutoFund.value && forcedAutoFund.value !== "auto"
		? forcedAutoFund.value
		: autoFund.value;
	const belowFloor = forcedLow.value === "below" ? true : forcedLow.value === "above" ? false : view.value.belowFloor;
	const v = view.value;

	return (
		<div class="wsp" data-kind="business">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" style={styleVars({ "--wsp-i": 0 })}>
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
					<section class="wsp-band wsp-band--plain" style={styleVars({ "--wsp-i": 1 })}>
						<div class="wsp-band__inner">
							<p class="wsp-billing__warning" role="status">
								The {currency} wallet holds {v.balanceLabel}, below the floor you set.{" "}
								<a class="wsp-moneyhead__link" href={walletHrefFor("business", ws.id)}>Top it up</a>
							</p>
						</div>
					</section>
				)}

				<section class="wsp-band wsp-band--money" style={styleVars({ "--wsp-i": 2 })}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">Invoices</h2>
							<span class="wsp-band__meta">
								{[
									v.nextInvoiceLabel,
									v.onAccount ? `${v.onAccount.owedLabel} owed on account of ${v.onAccount.limitLabel}` : null,
								].filter(Boolean).join(" · ") || "Settled per transaction"}
							</span>
						</div>
						<div class="wsp-band__body wsp-billing">
							{v.invoices.length === 0
								? (
									<p class="wsp-pagehead__meta">
										{v.invoicingMode === "intervaled_monthly"
											? "No invoices yet — the first is issued on the next billing day."
											: "On per-transaction billing each purchase is settled as it happens, so there is no monthly invoice."}
									</p>
								)
								: (
									<ul class="wsp-billing__list">
										{v.invoices.map((row) => (
											<li key={row.id} class="wsp-billing__row">
												<span class="wsp-billing__ident">
													<span class="wsp-billing__name">{row.periodLabel}</span>
													<span class="wsp-billing__meta">{row.dueLabel}</span>
												</span>
												<span class="wsp-billing__figure">
													{row.totalLabel}
													<span class="wsp-billing__meta"> total</span>
												</span>
												<span class="wsp-billing__figure">
													{row.amountDueMinor > 0 ? row.amountDueLabel : "—"}
													{row.amountDueMinor > 0 && <span class="wsp-billing__meta"> due</span>}
												</span>
												<span class="wsp-billing__acts">
													<Tag
														value={STATUS_LABEL[row.status]}
														severity={STATUS_SEVERITY[row.status]}
														variant="subtle"
														rounded
													/>
													<a class="wsp-moneyhead__link" href={row.pdfHref} download>PDF</a>
													{canEdit && row.amountDueMinor > 0 && (
														<Button
															severity="accent"
															rounded
															size="sm"
															label={`Pay ${row.amountDueLabel}`}
															loading={payingId.value === row.id}
															disabled={payingId.value !== null}
															onClick={() => void pay(row)}
														/>
													)}
												</span>
											</li>
										))}
									</ul>
								)}
							{notice.value && <p class="wsp-billing__note" role="status">{notice.value}</p>}
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--ledger" style={styleVars({ "--wsp-i": 3 })}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">Statements</h2>
							<span class="wsp-band__meta">Issued on the 1st</span>
						</div>
						<div class="wsp-band__body">
							{v.statements.length === 0
								? <p class="wsp-pagehead__meta">No statements yet — the first arrives on the 1st of next month.</p>
								: (
									<ul class="wsp-billing__list">
										{v.statements.map((row) => (
											<li key={row.id} class="wsp-billing__row">
												<span class="wsp-billing__name">{row.periodLabel}</span>
												<span class="wsp-billing__figure">
													{row.closingLabel}
													<span class="wsp-billing__meta"> closing</span>
												</span>
												<span />
												<span class="wsp-billing__acts">
													<a class="wsp-moneyhead__link" href={row.pdfHref} download>PDF</a>
												</span>
											</li>
										))}
									</ul>
								)}
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--money wsp-band--tail" style={styleVars({ "--wsp-i": 4 })}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">How billing works</h2>
							{!canEdit && <span class="wsp-band__meta">Only members who manage billing can change these</span>}
						</div>
						<div class="wsp-band__body wsp-billing__settings">
							<div class="wsp-billing__field">
								<span class="wsp-create__label" id="wsp-billing-mode">Invoicing</span>
								<SelectButton
									options={INVOICING_OPTIONS}
									value={mode.value}
									onValueChange={(next) => {
										mode.value = next as InvoicingMode;
										error.value = null;
									}}
									disabled={!canEdit || (!v.kybVerified && v.invoicingMode !== "intervaled_monthly")}
									aria-labelledby="wsp-billing-mode"
								/>
								<p class="wsp-billing__note">
									{v.kybVerified
										? "A monthly invoice lists the month's released escrow, fees and anything bought on account."
										: (
											<>
												Monthly invoicing needs business verification.{" "}
												<a class="wsp-moneyhead__link" href={workspaceHref(ws.kind, ws.handle, "verification")}>
													Verify {ws.name}
												</a>
											</>
										)}
								</p>
							</div>

							{mode.value === "intervaled_monthly" && (
								<label class="wsp-billing__field">
									<span class="wsp-create__label">Billing day</span>
									<InputNumber
										value={day.value}
										onValueChange={(next) => {
											day.value = Math.min(Math.max(Math.round(next ?? 1), 1), 28);
										}}
										min={1}
										max={28}
										showButtons
										disabled={!canEdit}
										aria-label="Billing day"
									/>
									<span class="wsp-billing__note">The day of the month the invoice is issued, 1–28.</span>
								</label>
							)}

							<label class="wsp-billing__field">
								<span class="wsp-create__label">Auto-funding</span>
								<Select
									options={AUTO_FUND_OPTIONS}
									value={autoFund.value}
									onValueChange={(next: string) => {
										autoFund.value = next as AutoFundMode;
									}}
									disabled={!canEdit}
									aria-label="Auto-funding"
								/>
								<span class="wsp-billing__note">
									{AUTO_FUND_SENTENCE[shownMode]} A project can override this in its details.
								</span>
							</label>

							<label class="wsp-billing__field">
								<span class="wsp-create__label">Balance floor</span>
								<InputNumber
									value={toMajorUnits(floor.value, currency)}
									onValueChange={(next) => {
										const minor = toMinorUnits(next, currency);
										floor.value = minor && minor > 0 ? minor : null;
									}}
									mode="currency"
									currency={currency}
									min={0}
									disabled={!canEdit}
									aria-label="Balance floor"
								/>
								<span class="wsp-billing__note">
									Everyone who can add funds is told once when the {currency}{" "}
									wallet drops below this. Clear it to turn the warning off. A recurring deposit can top up
									whenever it does.
								</span>
							</label>
						</div>
						{error.value && <p class="wsp-create__error" role="alert">{error.value}</p>}
					</div>
				</section>
			</div>
		</div>
	);
}
