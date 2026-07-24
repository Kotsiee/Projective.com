import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Money, SectionCard } from "../components/wallet-bits.tsx";
import { WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, openWalletAction } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { FundingView } from "../types/wallet-types.ts";

/**
 * WalletFundingScreen — `/wallet/funding`: funding sources, recurring auto-deposit rules (interval ·
 * amount · source · next-run · a failure-path note), and the top-up entry. THIN: SSR + refetch on dev
 * axis / mutation.
 */
export interface WalletFundingScreenProps {
	initial: FundingView;
	wallet: string;
	display: string;
}

export default function WalletFundingScreen(props: WalletFundingScreenProps): JSX.Element {
	const view = useSignal<FundingView>(props.initial);
	async function reload(): Promise<void> {
		const res = await WalletService.funding(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.funding;
	}
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	const f = view.value;
	return (
		<div class="wallet-page wallet-funding">
			<header class="wallet-page__head">
				<h1 class="wallet-page__title">Funding</h1>
				<button
					type="button"
					class="wallet-btn wallet-btn--primary"
					onClick={() => openWalletAction("top_up")}
				>
					<WalletIcon name="topup" size={16} /> Top up
				</button>
			</header>

			<div class="wallet-figure wallet-figure--hero">
				<span class="wallet-figure__label">Available to spend</span>
				<Money value={f.balance} class="wallet-figure__value" />
			</div>

			<SectionCard
				title="Funding sources"
				action={
					<button
						type="button"
						class="wallet-btn wallet-btn--ghost"
						onClick={() => openWalletAction("add_method")}
					>
						Add source
					</button>
				}
			>
				{f.sources.length === 0
					? <p class="wallet-empty-note">No funding sources yet.</p>
					: (
						<ul class="wallet-methods__list">
							{f.sources.map((s) => (
								<li key={s.id} class="wallet-methods__row">
									<span class="wallet-methods__brand">
										<WalletIcon name="card" size={18} /> {s.brand ?? "Card"} ·· {s.last4 ?? "0000"}
									</span>
									<span class="wallet-methods__label">{s.label}</span>
									{s.isDefault && <span class="wallet-badge" data-tone="info">Default</span>}
								</li>
							))}
						</ul>
					)}
			</SectionCard>

			<SectionCard
				title="Recurring deposits"
				action={
					<button
						type="button"
						class="wallet-btn wallet-btn--ghost"
						onClick={() => openWalletAction("new_recurring")}
					>
						New rule
					</button>
				}
			>
				{f.rules.length === 0
					? (
						<p class="wallet-empty-note">
							No recurring deposits. Set one up to keep a working balance.
						</p>
					)
					: (
						<ul class="wallet-rules">
							{f.rules.map((r) => (
								<li
									key={r.id}
									class="wallet-rules__row"
									data-failing={r.failureNote ? "true" : undefined}
								>
									<span class="wallet-rules__glyph" aria-hidden="true">
										<WalletIcon name="recurring" size={18} />
									</span>
									<span class="wallet-rules__meta">
										<span class="wallet-rules__amt">
											<Money value={r.amount} /> · {r.interval}
										</span>
										<span class="wallet-rules__sub">
											{r.sourceLabel ? `From ${r.sourceLabel} · ` : ""}Next {r.nextRunLabel}
										</span>
										{r.failureNote && (
											<span class="wallet-rules__fail" role="alert">{r.failureNote}</span>
										)}
									</span>
									<span class="wallet-badge" data-tone={r.active ? "success" : "muted"}>
										{r.active ? "Active" : "Paused"}
									</span>
								</li>
							))}
						</ul>
					)}
			</SectionCard>
		</div>
	);
}
