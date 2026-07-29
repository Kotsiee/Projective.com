import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Band, EmptyBand, PageHead } from "../components/band-parts.tsx";
import { fundStateLabel } from "../components/FundStateMark.tsx";
import LedgerTable from "./LedgerTable.island.tsx";
import TransactionDrawer from "./TransactionDrawer.island.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, fundFilter } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { TransactionPage } from "../types/wallet-types.ts";

/**
 * WalletTransactionsScreen — the full ledger (`/wallet/transactions`).
 *
 * The table gets 100% of the content region at every breakpoint: a ledger is the one artefact a
 * user cross-reads horizontally, and cropping it into a centred column is exactly the failure this
 * redesign removes. There is deliberately NO toolbar here — search and filtering live in the header
 * band, sort and density in the footer rig, and every action in the footer's cluster (§6).
 *
 * A fund state selected from the Overview's capital meter arrives as the shared `fundFilter` signal
 * and is reflected in the page head, so the hero and the ledger stay in one conversation.
 */
export interface WalletTransactionsScreenProps {
	initial: TransactionPage;
	wallet: string;
	display: string;
}

export default function WalletTransactionsScreen(
	props: WalletTransactionsScreenProps,
): JSX.Element {
	const page = useSignal<TransactionPage>(props.initial);

	const refetch = async () => {
		const res = await WalletService.transactions(currentWalletContext(), {
			limit: 40,
			...(fundFilter.value ? { fundState: fundFilter.value } : {}),
		});
		if (res.ok && res.data) page.value = res.data.page;
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const p = page.value;
	const filter = fundFilter.value;

	return (
		<main class="wlt" aria-label="Transactions">
			<div class="wlt__stack">
				<Band tone="head" index={0} label="Transactions">
					<PageHead
						title="Transactions"
						meta={
							<>
								<span>{p.total.toLocaleString("en-GB")} movements</span>
								{filter && (
									<span class="wlt-pagehead__filter">
										{fundStateLabel(filter)} ·{" "}
										<a
											class="wlt-link"
											href="/wallet/transactions"
											onClick={(e) => {
												e.preventDefault();
												fundFilter.value = null;
												void refetch();
											}}
										>
											show all
										</a>
									</span>
								)}
							</>
						}
					/>
				</Band>

				<Band tone="page" index={1} label="Ledger">
					{p.items.length === 0
						? (
							<EmptyBand
								text="No transactions match this view."
								hint="Movements appear here as escrow funds, releases and payouts settle."
							/>
						)
						: <LedgerTable page={p} scope={props.wallet} display={props.display} />}
				</Band>
			</div>
			<TransactionDrawer />
		</main>
	);
}
