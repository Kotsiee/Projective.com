import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Band, BandHead, EmptyBand, PageHead } from "../components/band-parts.tsx";
import { Money } from "../components/Money.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { FundingView } from "../types/wallet-types.ts";

/**
 * WalletFundingScreen — where money comes IN (`/wallet/funding`).
 *
 * Two bands: the sources money can be drawn from, and the recurring rules that draw it. A FAILING
 * rule is the one thing on this page that must not be quiet — a silently failing auto-deposit is
 * how a client discovers at escrow-funding time that their card expired — so it carries a
 * `role="alert"` note rather than a status dot (§B.6's icon-only rule yields where the state is
 * actionable and time-sensitive).
 */
export interface WalletFundingScreenProps {
	initial: FundingView;
	wallet: string;
	display: string;
}

export default function WalletFundingScreen(props: WalletFundingScreenProps): JSX.Element {
	const view = useSignal<FundingView>(props.initial);

	const refetch = async () => {
		const res = await WalletService.funding(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.funding;
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const f = view.value;

	return (
		<main class="wlt" aria-label="Funding">
			<div class="wlt__stack">
				<Band tone="head" index={0} label="Funding">
					<PageHead
						title="Funding"
						meta={
							<span>
								Available <Money value={f.balance} size="body" showFx={false} />
							</span>
						}
					/>
				</Band>

				<Band tone="intel" index={1} titleId="wlt-fund-src">
					<BandHead id="wlt-fund-src" title="Sources" />
					{f.sources.length === 0
						? (
							<EmptyBand
								text="No funding source yet."
								hint="Add one from the action bar to top up this wallet."
							/>
						)
						: (
							<ul class="wlt-rows" role="list">
								{f.sources.map((s) => (
									<li class="wlt-rows__row" key={s.id}>
										<span class="wlt-rows__title">{s.label}</span>
										<span class="wlt-rows__meta wlt-num">
											{s.brand ? `${s.brand} ·· ${s.last4 ?? "—"}` : ""}
										</span>
										{s.isDefault && <span class="wlt-rows__tag">Default</span>}
									</li>
								))}
							</ul>
						)}
				</Band>

				<Band tone="ledger" index={2} titleId="wlt-fund-rules">
					<BandHead id="wlt-fund-rules" title="Recurring deposits" />
					{f.rules.length === 0
						? (
							<EmptyBand
								text="No recurring deposits."
								hint="A schedule keeps a vault funded without repeated card charges."
							/>
						)
						: (
							<ul class="wlt-rows wlt-rows--ledger" role="list">
								{f.rules.map((r) => (
									<li
										class="wlt-rows__row"
										key={r.id}
										data-failing={r.failureNote ? "true" : "false"}
									>
										<span class="wlt-rows__title">
											<Money value={r.amount} size="body" showFx={false} /> · {r.interval}
										</span>
										<span class="wlt-rows__meta">
											{r.sourceLabel ? `From ${r.sourceLabel} · ` : ""}
											{r.nextRunLabel}
										</span>
										{r.failureNote
											? <span class="wlt-rows__alert" role="alert">{r.failureNote}</span>
											: (
												<span class="wlt-rows__tag" data-tone={r.active ? "ok" : "muted"}>
													{r.active ? "Active" : "Paused"}
												</span>
											)}
									</li>
								))}
							</ul>
						)}
				</Band>
			</div>
		</main>
	);
}
