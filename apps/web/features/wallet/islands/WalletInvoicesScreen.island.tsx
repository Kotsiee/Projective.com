import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Tooltip } from "@projective/ui/feedback";
import { Band, BandHead, EmptyBand, PageHead, WalletErrorBand } from "../components/band-parts.tsx";
import { Money } from "../components/Money.tsx";
import { CapsRoster } from "../components/CapsRoster.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, walletError } from "../core/wallet-state.ts";
import { applyRead, useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { InvoicesView } from "../types/wallet-types.ts";

/**
 * WalletInvoicesScreen — statements and bills (`/wallet/invoices`, business variant).
 *
 * An overdue bill carries a `--wlt-dispute` STATUS CHIP, never a red amount: the money owed is a
 * fact about a date, not about the figure, and colouring the number red says "this amount is wrong"
 * (RULE C-1). Status is a dot plus a tooltip, per the dense-row rule.
 */
export interface WalletInvoicesScreenProps {
	initial: InvoicesView;
	wallet: string;
	display: string;
}

export default function WalletInvoicesScreen(props: WalletInvoicesScreenProps): JSX.Element {
	const view = useSignal<InvoicesView>(props.initial);

	const refetch = async () => {
		const res = await WalletService.invoices(currentWalletContext());
		applyRead(res, (d) => {
			view.value = d.invoices;
		});
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const v = view.value;
	const hasAnything = v.current || v.statements.length > 0 || v.bills.length > 0;

	if (!hasAnything) {
		return (
			<main class="wlt" aria-label="Invoices">
				<div class="wlt__stack">
					<WalletErrorBand message={walletError.value} />
					<Band tone="head" index={0} label="Invoices">
						<PageHead title="Invoices" />
					</Band>
					<Band tone="page" index={1} label="Statements">
						<EmptyBand
							text="Statements appear here at the end of each billing cycle."
							hint="Invoices and statements are a business-wallet instrument."
						/>
					</Band>
				</div>
			</main>
		);
	}

	return (
		<main class="wlt" aria-label="Invoices">
			<div class="wlt__stack">
				<WalletErrorBand message={walletError.value} />
				<Band tone="head" index={0} label="Invoices">
					<PageHead
						title="Invoices"
						meta={
							<>
								<span>{v.bills.length} due</span>
								<span>{v.statements.length} statements</span>
							</>
						}
					/>
				</Band>

				{v.current && (
					<Band tone="intel" index={1} titleId="wlt-inv-cur">
						<BandHead
							id="wlt-inv-cur"
							title={`This cycle · ${v.current.periodLabel}`}
							meta={<span class="wlt-rows__tag">Accruing</span>}
						/>
						<dl class="wlt-facts wlt-facts--inline">
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">In</dt>
								<dd class="wlt-facts__value">
									<Money value={v.current.totalIn} size="figure" tone="credit" showFx={false} />
								</dd>
							</div>
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Out</dt>
								<dd class="wlt-facts__value">
									<Money value={v.current.totalOut} size="figure" tone="debit" showFx={false} />
								</dd>
							</div>
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Fees</dt>
								<dd class="wlt-facts__value">
									<Money value={v.current.totalFees} size="figure" tone="fee" showFx={false} />
								</dd>
							</div>
						</dl>
					</Band>
				)}

				<Band tone="flow" index={2} titleId="wlt-inv-bills">
					<BandHead id="wlt-inv-bills" title="Bills due" />
					{v.bills.length === 0
						? <EmptyBand text="Nothing due." />
						: (
							<ul class="wlt-rows wlt-rows--ledger" role="list">
								{v.bills.map((b) => (
									<li class="wlt-rows__row" key={b.id} data-overdue={b.overdue ? "true" : "false"}>
										<Tooltip content={b.overdue ? "Overdue" : b.status} placement="top">
											<span class="wlt-rows__chip" data-tone={b.overdue ? "dispute" : "neutral"}>
												{b.overdue ? "Overdue" : b.status}
											</span>
										</Tooltip>
										<span class="wlt-rows__title">{b.label}</span>
										<span class="wlt-rows__meta">{b.dueLabel}</span>
										<span class="wlt-rows__amount">
											<Money value={b.amount} size="body" tone="debit" showFx={false} />
										</span>
									</li>
								))}
							</ul>
						)}
				</Band>

				<Band tone="ledger" index={3} titleId="wlt-inv-stmt">
					<BandHead id="wlt-inv-stmt" title="Statements" />
					{v.statements.length === 0
						? <EmptyBand text="No statements yet." />
						: (
							<ul class="wlt-rows wlt-rows--ledger" role="list">
								{v.statements.map((s) => (
									<li class="wlt-rows__row" key={s.id}>
										<span class="wlt-rows__title">{s.periodLabel}</span>
										<span class="wlt-rows__meta">
											<Money value={s.totalIn} size="body" tone="credit" sign="+" showFx={false} />
											{" "}
											<Money value={s.totalOut} size="body" tone="debit" sign="−" showFx={false} />
										</span>
										{s.hasPdf
											? <a class="wlt-link" href={`/api/wallet/statement/${s.id}`}>PDF</a>
											: <span class="wlt-rows__tag" data-tone="muted">{s.status}</span>}
									</li>
								))}
							</ul>
						)}
				</Band>

				{v.caps.length > 0 && (
					<Band tone="intel" index={4} titleId="wlt-inv-caps">
						<BandHead id="wlt-inv-caps" title="Budgets and caps" />
						<CapsRoster caps={v.caps} invoicesDue={0} invoicesDueAmount={null} />
					</Band>
				)}
			</div>
		</main>
	);
}
