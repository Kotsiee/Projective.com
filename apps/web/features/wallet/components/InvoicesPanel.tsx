import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { MoneyView } from "@projective/ui/display/money";
import type { BillRow, InvoicesView, StatementRow } from "../types/wallet-types.ts";

/** Props for {@link InvoicesPanel}. */
export interface InvoicesPanelProps {
	/** The vault's bills and statements, or `null` when the read failed and nothing is loaded. */
	view: InvoicesView | null;
	/** Whether this wallet is billed at all — only a business vault is. */
	billed: boolean;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
}

const STATEMENT_STATUS: Readonly<Record<StatementRow["status"], string>> = {
	draft: "Accruing",
	issued: "Issued",
	final: "Final",
};

function StatementFacts({ row }: { row: StatementRow }): JSX.Element {
	return (
		<dl class="wlt-dlg__facts">
			<div class="wlt-dlg__fact">
				<dt>Money in</dt>
				<dd>
					<MoneyView value={row.totalIn} size="body" hideOrigin />
				</dd>
			</div>
			<div class="wlt-dlg__fact">
				<dt>Money out</dt>
				<dd>
					<MoneyView value={row.totalOut} size="body" hideOrigin />
				</dd>
			</div>
			<div class="wlt-dlg__fact">
				<dt>Fees</dt>
				<dd>
					<MoneyView value={row.totalFees} size="body" hideOrigin />
				</dd>
			</div>
		</dl>
	);
}

function BillItem({ bill }: { bill: BillRow }): JSX.Element {
	return (
		<li class="wlt-statement" data-overdue={bill.overdue ? "true" : undefined}>
			<span class="wlt-statement__text">
				<span class="wlt-statement__title">{bill.label}</span>
				<span class="wlt-statement__meta">{bill.dueLabel}</span>
			</span>
			<MoneyView value={bill.amount} size="body" hideOrigin class="wlt-statement__amount" />
		</li>
	);
}

/**
 * A business vault's bills and monthly statements — what the vault owes, the month still accruing, and
 * what each closed month came to. Every figure is the server's; the panel only lays them out.
 */
export function InvoicesPanel(props: InvoicesPanelProps): JSX.Element {
	const v = props.view;
	if (!props.billed) {
		return (
			<section class="wlt-section" aria-labelledby="wlt-bills-title">
				<h2 id="wlt-bills-title" class="wlt-section__title">Invoices & statements</h2>
				<p class="wlt-empty">
					Only a business vault is billed and receives monthly statements. Switch to one from the
					wallet menu to see its invoices.
				</p>
			</section>
		);
	}
	return (
		<div class="wlt-statements wlt-statements--page" aria-busy={props.loading ? "true" : "false"}>
			{v && (
				<>
					<section class="wlt-section" aria-labelledby="wlt-bills-title">
						<h2 id="wlt-bills-title" class="wlt-section__title">Bills due</h2>
						{v.bills.length > 0
							? (
								<ul class="wlt-statements__list">
									{v.bills.map((bill) => <BillItem key={bill.id} bill={bill} />)}
								</ul>
							)
							: <p class="wlt-empty">Nothing is due.</p>}
					</section>
					{v.current && (
						<section class="wlt-section" aria-labelledby="wlt-current-title">
							<h2 id="wlt-current-title" class="wlt-section__title">{v.current.periodLabel}</h2>
							<StatementFacts row={v.current} />
						</section>
					)}
					<section class="wlt-section" aria-labelledby="wlt-past-title">
						<h2 id="wlt-past-title" class="wlt-section__title">Past statements</h2>
						{v.statements.length > 0
							? (
								<ul class="wlt-statements__list">
									{v.statements.map((row) => (
										<li key={row.id} class="wlt-statement">
											<span class="wlt-statement__text">
												<span class="wlt-statement__title">{row.periodLabel}</span>
												<span class="wlt-statement__meta">
													In <MoneyView value={row.totalIn} size="micro" hideOrigin /> · Out{" "}
													<MoneyView value={row.totalOut} size="micro" hideOrigin /> · Fees{" "}
													<MoneyView value={row.totalFees} size="micro" hideOrigin />
												</span>
											</span>
											<span class="wlt-statement__status">{STATEMENT_STATUS[row.status]}</span>
										</li>
									))}
								</ul>
							)
							: <p class="wlt-empty">No earlier statements yet.</p>}
					</section>
				</>
			)}
			{props.error && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.loading}
					align="start"
					class="wlt-notice"
				/>
			)}
		</div>
	);
}
