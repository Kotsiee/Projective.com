import type { JSX } from "preact";
import { Money, SectionCard } from "./wallet-bits.tsx";
import { WalletIcon } from "./wallet-glyphs.tsx";
import type { IncomeSmootherState } from "../types/wallet-types.ts";

/**
 * IncomeSmootherCard — the three-state Income Smoother card (finance-model.md §1.4), reused on the
 * personal Overview + the Payouts page. **Ineligible** → a locked card with a progress meter to the
 * 3-month gate. **Eligible** → the enrolment CTA. **Enrolled** → the status card (target monthly · the
 * projected smoothed figure · the ~0.5% fee). The eligibility flag is server-derived; the card only
 * presents it. Pure but takes an `onEnrol` callback the island wires to the enrolment modal.
 */
export interface IncomeSmootherCardProps {
	state: IncomeSmootherState;
	onEnrol?: () => void;
}

export function IncomeSmootherCard({ state, onEnrol }: IncomeSmootherCardProps): JSX.Element {
	const feePct = (state.feeBp / 100).toFixed(1);

	if (state.status === "ineligible") {
		const pct = state.monthsRequired > 0
			? Math.min(100, Math.round((state.monthsElapsed / state.monthsRequired) * 100))
			: 0;
		return (
			<SectionCard class="wallet-smoother" title="Income Smoother">
				<div class="wallet-smoother__locked">
					<span class="wallet-smoother__glyph" aria-hidden="true">
						<WalletIcon name="smoother" size={22} />
					</span>
					<p class="wallet-smoother__note">
						Turn uneven earnings into a steady monthly income. Unlocks after {state.monthsRequired}
						{" "}
						months of earnings — about {state.weeksToGo} weeks to go.
					</p>
					<div
						class="wallet-smoother__progress"
						role="meter"
						aria-valuenow={pct}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label="Eligibility progress"
					>
						<span class="wallet-smoother__progress-fill" style={`inline-size:${pct}%`} />
					</div>
				</div>
			</SectionCard>
		);
	}

	if (state.status === "eligible") {
		return (
			<SectionCard class="wallet-smoother" title="Income Smoother">
				<div class="wallet-smoother__eligible">
					<span class="wallet-smoother__glyph" aria-hidden="true">
						<WalletIcon name="smoother" size={22} />
					</span>
					<p class="wallet-smoother__note">
						You're eligible. Set a target monthly figure and we'll buffer the peaks to top up the
						troughs — for a {feePct}% micro-fee.
					</p>
					<button
						type="button"
						class="wallet-btn wallet-btn--primary wallet-smoother__cta"
						onClick={onEnrol}
					>
						Set up smoothing
					</button>
				</div>
			</SectionCard>
		);
	}

	return (
		<SectionCard
			class="wallet-smoother"
			title="Income Smoother"
			action={<span class="wallet-badge" data-tone="success">Active</span>}
		>
			<div class="wallet-smoother__enrolled">
				<div class="wallet-smoother__figure">
					<span class="wallet-smoother__figure-label">Target monthly</span>
					{state.targetMonthly && (
						<Money value={state.targetMonthly} class="wallet-smoother__figure-value" />
					)}
				</div>
				<div class="wallet-smoother__figure">
					<span class="wallet-smoother__figure-label">Projected this month</span>
					{state.projected && (
						<Money value={state.projected} class="wallet-smoother__figure-value" />
					)}
				</div>
				<p class="wallet-smoother__fee">Smoothing fee {feePct}% of buffered income.</p>
			</div>
		</SectionCard>
	);
}
