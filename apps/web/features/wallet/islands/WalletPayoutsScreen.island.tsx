import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Tooltip } from "@projective/ui/feedback";
import { Band, BandHead, EmptyBand, PageHead, WalletErrorBand } from "../components/band-parts.tsx";
import { FundStateMark } from "../components/FundStateMark.tsx";
import { VerificationGate } from "../components/VerificationGate.tsx";
import { Money } from "../components/Money.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, walletError } from "../core/wallet-state.ts";
import { applyRead, useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type { PayoutsView } from "../types/wallet-types.ts";

/**
 * WalletPayoutsScreen — payout configuration and history (`/wallet/payouts`).
 *
 * The schedule reads as a statement of fact rather than a form: every control that CHANGES it lives
 * in the footer rig (§6.3). History is a ledger-shaped table showing what each run actually cost —
 * the flat 5% platform fee and the marketplace commission at the acting rung — because a payout the
 * user cannot decompose is a payout they will distrust.
 *
 * The Instant Payout offer discloses "a small fee applies" and nothing more: its magnitude is an
 * undecided platform economic, and rendering a placeholder percentage would be fabricating policy.
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
	threshold: "At a threshold",
};

const STATUS_STATE = {
	paid: "available",
	in_transit: "pending",
	pending: "pending",
	failed: "on_hold",
} as const;

export default function WalletPayoutsScreen(props: WalletPayoutsScreenProps): JSX.Element {
	const view = useSignal<PayoutsView>(props.initial);

	const refetch = async () => {
		const res = await WalletService.payouts(currentWalletContext());
		applyRead(res, (d) => {
			view.value = d.payouts;
		});
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const p = view.value;

	return (
		<main class="wlt" aria-label="Payouts">
			<div class="wlt__stack">
				<WalletErrorBand message={walletError.value} />
				<Band tone="head" index={0} label="Payouts">
					<PageHead
						title="Payouts"
						meta={<span>{p.history.length} runs</span>}
					/>
					<VerificationGate verification={p.verification} tone="inline" />
				</Band>

				<Band tone="intel" index={1} titleId="wlt-pay-sched">
					<BandHead id="wlt-pay-sched" title="Schedule" />
					<dl class="wlt-facts">
						<div class="wlt-facts__row">
							<dt class="wlt-facts__label">Frequency</dt>
							<dd class="wlt-facts__value">{MODE_LABEL[p.schedule.mode] ?? p.schedule.mode}</dd>
						</div>
						{p.schedule.threshold && (
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Threshold</dt>
								<dd class="wlt-facts__value">
									<Money value={p.schedule.threshold} size="body" showFx={false} />
								</dd>
							</div>
						)}
						{p.schedule.destinationLabel && (
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Destination</dt>
								<dd class="wlt-facts__value">{p.schedule.destinationLabel}</dd>
							</div>
						)}
						{p.schedule.nextRunLabel && (
							<div class="wlt-facts__row">
								<dt class="wlt-facts__label">Next run</dt>
								<dd class="wlt-facts__value">{p.schedule.nextRunLabel}</dd>
							</div>
						)}
						<div class="wlt-facts__row">
							<dt class="wlt-facts__label">Available now</dt>
							<dd class="wlt-facts__value">
								<Money value={p.instantAvailable} size="body" showFx={false} />
							</dd>
						</div>
					</dl>
					{/* The magnitude is deliberately undecided platform-wide — never a percentage. */}
					<p class="wlt-prose wlt-facts__note">{p.instantFeeLabel}</p>
				</Band>

				<Band tone="flow" index={2} titleId="wlt-pay-dest">
					<BandHead id="wlt-pay-dest" title="Destinations" />
					{p.destinations.length === 0
						? (
							<EmptyBand
								text="No payout destination yet."
								hint="Choose “Payout schedule” in the action bar to set where money goes."
							/>
						)
						: (
							<ul class="wlt-rows" role="list">
								{p.destinations.map((d) => (
									<li class="wlt-rows__row" key={d.id}>
										<span class="wlt-rows__title">{d.label}</span>
										<span class="wlt-rows__meta wlt-num">
											{d.brand ? `${d.brand} ·· ${d.last4 ?? "—"}` : d.last4 ?? ""}
										</span>
										{d.isDefault && <span class="wlt-rows__tag">Default</span>}
									</li>
								))}
							</ul>
						)}
				</Band>

				<Band tone="ledger" index={3} titleId="wlt-pay-hist">
					<BandHead id="wlt-pay-hist" title="History" />
					{p.history.length === 0
						? <EmptyBand text="No payouts yet." />
						: (
							<ul class="wlt-rows wlt-rows--ledger" role="list">
								{p.history.map((h) => (
									<li class="wlt-rows__row" key={h.id}>
										<Tooltip content={h.status.replace("_", " ")} placement="top">
											<span class="wlt-rows__state" aria-label={`Status: ${h.status}`}>
												<FundStateMark state={STATUS_STATE[h.status]} clearingFraction={0.6} />
											</span>
										</Tooltip>
										<span class="wlt-rows__title">{h.destinationLabel}</span>
										<span class="wlt-rows__meta">{h.dateLabel}</span>
										<span class="wlt-rows__amount">
											<Money value={h.amount} size="body" tone="debit" sign="−" showFx={false} />
										</span>
									</li>
								))}
							</ul>
						)}
				</Band>
			</div>
		</main>
	);
}
