import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Money, SectionCard } from "../components/wallet-bits.tsx";
import { IncomeSmootherCard } from "../components/IncomeSmootherCard.tsx";
import { WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, openWalletAction } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { PayoutHistoryRow, PayoutsView } from "../types/wallet-types.ts";

/**
 * WalletPayoutsScreen — `/wallet/payouts`: the payout-schedule summary + editor trigger, destinations,
 * the Income Smoother, the Instant Payout offer (fee disclosed as configurable — never a fabricated %),
 * and withdrawal history. Withdrawal paths are locked behind the verification gate (a freelancer without
 * payout setup sees a prompt instead of the controls). THIN: SSR + refetch on dev axis / mutation.
 */
export interface WalletPayoutsScreenProps {
	initial: PayoutsView;
	wallet: string;
	display: string;
}

const MODE_LABEL: Record<string, string> = {
	manual: "Manual",
	scheduled_weekly: "Weekly",
	scheduled_monthly: "Monthly",
	threshold: "When balance reaches a threshold",
};

export default function WalletPayoutsScreen(props: WalletPayoutsScreenProps): JSX.Element {
	const view = useSignal<PayoutsView>(props.initial);
	async function reload(): Promise<void> {
		const res = await WalletService.payouts(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.payouts;
	}
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	const p = view.value;
	const locked = !p.verification.canWithdraw;

	return (
		<div class="wallet-page wallet-payouts">
			<header class="wallet-page__head">
				<h1 class="wallet-page__title">Payouts</h1>
			</header>

			{locked && p.verification.prompt && (
				<div class="wallet-verify" role="status" data-locked="true">
					<span class="wallet-verify__glyph" aria-hidden="true">
						<WalletIcon name="access" size={20} />
					</span>
					<p class="wallet-verify__text">{p.verification.prompt}</p>
					{p.verification.href && (
						<a class="wallet-btn wallet-btn--primary" href={p.verification.href}>Finish setup</a>
					)}
				</div>
			)}

			<div class="wallet-payouts__grid">
				<SectionCard
					title="Schedule"
					class="wallet-payouts__schedule"
					action={
						<button
							type="button"
							class="wallet-btn wallet-btn--ghost"
							disabled={locked}
							onClick={() => openWalletAction("set_payout")}
						>
							Edit
						</button>
					}
				>
					<div class="wallet-metarow">
						<span class="wallet-metarow__label">Frequency</span>
						<span class="wallet-metarow__value">
							{MODE_LABEL[p.schedule.mode] ?? p.schedule.mode}
						</span>
					</div>
					{p.schedule.threshold && (
						<div class="wallet-metarow">
							<span class="wallet-metarow__label">Threshold</span>
							<span class="wallet-metarow__value">
								<Money value={p.schedule.threshold} />
							</span>
						</div>
					)}
					{p.schedule.destinationLabel && (
						<div class="wallet-metarow">
							<span class="wallet-metarow__label">To</span>
							<span class="wallet-metarow__value">{p.schedule.destinationLabel}</span>
						</div>
					)}
					{p.schedule.nextRunLabel && (
						<div class="wallet-metarow">
							<span class="wallet-metarow__label">Next run</span>
							<span class="wallet-metarow__value">{p.schedule.nextRunLabel}</span>
						</div>
					)}
				</SectionCard>

				<SectionCard
					title="Instant payout"
					class="wallet-payouts__instant"
					action={
						<button
							type="button"
							class="wallet-btn wallet-btn--primary"
							disabled={locked}
							onClick={() => openWalletAction("withdraw")}
						>
							Withdraw now
						</button>
					}
				>
					<div class="wallet-figure">
						<span class="wallet-figure__label">Available</span>
						<Money value={p.instantAvailable} class="wallet-figure__value" />
					</div>
					<p class="wallet-figure__sub">{p.instantFeeLabel}</p>
				</SectionCard>
			</div>

			{p.incomeSmoother && (
				<IncomeSmootherCard
					state={p.incomeSmoother}
					onEnrol={() => openWalletAction("enrol_smoother")}
				/>
			)}

			<SectionCard
				title="Destinations"
				class="wallet-payouts__dests"
				action={
					<button
						type="button"
						class="wallet-btn wallet-btn--ghost"
						onClick={() => openWalletAction("add_method")}
					>
						Add
					</button>
				}
			>
				{p.destinations.length === 0
					? <p class="wallet-empty-note">No payout destinations yet.</p>
					: (
						<ul class="wallet-methods__list">
							{p.destinations.map((d) => (
								<li key={d.id} class="wallet-methods__row">
									<span class="wallet-methods__brand">
										<WalletIcon name="card" size={18} /> {d.brand ?? "Bank"} ·· {d.last4 ?? "0000"}
									</span>
									<span class="wallet-methods__label">{d.label}</span>
									{d.isDefault && <span class="wallet-badge" data-tone="info">Default</span>}
								</li>
							))}
						</ul>
					)}
			</SectionCard>

			<SectionCard title="History" class="wallet-payouts__history">
				{p.history.length === 0
					? <p class="wallet-empty-note">No withdrawals yet.</p>
					: (
						<ul class="wallet-histlist">
							{p.history.map((h) => <HistoryRow key={h.id} row={h} />)}
						</ul>
					)}
			</SectionCard>
		</div>
	);
}

function HistoryRow({ row }: { row: PayoutHistoryRow }): JSX.Element {
	const tone = row.status === "paid" ? "success" : row.status === "failed" ? "danger" : "warning";
	const label = row.status === "in_transit"
		? "In transit"
		: row.status.charAt(0).toUpperCase() + row.status.slice(1);
	return (
		<li class="wallet-histlist__row">
			<span class="wallet-histlist__meta">
				<span class="wallet-histlist__dest">{row.destinationLabel}</span>
				<span class="wallet-histlist__date">{row.dateLabel}</span>
			</span>
			<span class="wallet-chip" data-tone={tone}>{label}</span>
			<Money value={row.amount} class="wallet-histlist__amt" />
		</li>
	);
}
