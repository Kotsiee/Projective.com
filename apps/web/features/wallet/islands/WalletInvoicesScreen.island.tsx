import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Meter, Money, SectionCard } from "../components/wallet-bits.tsx";
import { ExportIcon, WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { InvoicesView, StatementRow } from "../types/wallet-types.ts";

/**
 * WalletInvoicesScreen — `/wallet/invoices` (business): the live accruing current-cycle statement, past
 * monthly statements (PDF), bills due (with over-budget prompts), and the spending caps. THIN: SSR +
 * refetch on dev axis / mutation. Non-business wallets show an empty state.
 */
export interface WalletInvoicesScreenProps {
	initial: InvoicesView;
	wallet: string;
	display: string;
}

export default function WalletInvoicesScreen(props: WalletInvoicesScreenProps): JSX.Element {
	const view = useSignal<InvoicesView>(props.initial);
	async function reload(): Promise<void> {
		const res = await WalletService.invoices(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.invoices;
	}
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	const inv = view.value;
	const empty = !inv.current && inv.statements.length === 0 && inv.bills.length === 0;

	return (
		<div class="wallet-page wallet-invoices">
			<header class="wallet-page__head">
				<h1 class="wallet-page__title">Invoices & statements</h1>
			</header>

			{empty && (
				<p class="wallet-empty-note" role="status">
					Consolidated statements are available on business wallets.
				</p>
			)}

			{inv.current && (
				<SectionCard
					title="This cycle"
					class="wallet-invoices__current"
					action={<span class="wallet-badge" data-tone="info">Accruing</span>}
				>
					<div class="wallet-statement">
						<span class="wallet-statement__period">{inv.current.periodLabel}</span>
						<div class="wallet-statement__figs">
							<span class="wallet-figure">
								<span class="wallet-figure__label">In</span>
								<Money value={inv.current.totalIn} class="wallet-figure__value" />
							</span>
							<span class="wallet-figure">
								<span class="wallet-figure__label">Out</span>
								<Money value={inv.current.totalOut} class="wallet-figure__value" />
							</span>
							<span class="wallet-figure">
								<span class="wallet-figure__label">Fees</span>
								<Money value={inv.current.totalFees} muted class="wallet-figure__value" />
							</span>
						</div>
					</div>
				</SectionCard>
			)}

			{inv.bills.length > 0 && (
				<SectionCard title="Bills due" class="wallet-invoices__bills">
					<ul class="wallet-bills">
						{inv.bills.map((b) => (
							<li
								key={b.id}
								class="wallet-bills__row"
								data-overdue={b.overdue ? "true" : undefined}
							>
								<span class="wallet-bills__meta">
									<span class="wallet-bills__label">{b.label}</span>
									<span class="wallet-bills__due" data-overdue={b.overdue ? "true" : undefined}>
										{b.dueLabel}
									</span>
								</span>
								<Money value={b.amount} class="wallet-bills__amt" />
								{b.overdue && (
									<button type="button" class="wallet-btn wallet-btn--primary wallet-bills__cta">
										Top up
									</button>
								)}
							</li>
						))}
					</ul>
				</SectionCard>
			)}

			{inv.statements.length > 0 && (
				<SectionCard title="Statements" class="wallet-invoices__statements">
					<ul class="wallet-statements">
						{inv.statements.map((s) => <StatementRowView key={s.id} row={s} />)}
					</ul>
				</SectionCard>
			)}

			{inv.caps.length > 0 && (
				<SectionCard title="Budgets & caps" class="wallet-invoices__caps">
					<ul class="wallet-caps__list">
						{inv.caps.map((c) => (
							<li key={c.id} class="wallet-caps__row">
								<span class="wallet-caps__name">{c.memberName}</span>
								<Meter
									ratioBp={c.utilizationBp}
									label={`${c.memberName} cap`}
									class="wallet-caps__meter"
								/>
								<span class="wallet-caps__amt">
									<Money value={c.spent} />{" "}
									<span class="wallet-caps__of">
										/ <Money value={c.cap} muted />
									</span>
								</span>
							</li>
						))}
					</ul>
				</SectionCard>
			)}
		</div>
	);
}

function StatementRowView({ row }: { row: StatementRow }): JSX.Element {
	return (
		<li class="wallet-statements__row">
			<span class="wallet-statements__period">{row.periodLabel}</span>
			<span class="wallet-statements__figs">
				<span class="wallet-statements__in">
					+<Money value={row.totalIn} />
				</span>
				<span class="wallet-statements__out">
					−<Money value={row.totalOut} />
				</span>
			</span>
			{row.hasPdf
				? (
					<button type="button" class="wallet-btn wallet-btn--ghost wallet-statements__pdf">
						<ExportIcon size={15} /> PDF
					</button>
				)
				: <span class="wallet-badge" data-tone="muted">Draft</span>}
		</li>
	);
}
