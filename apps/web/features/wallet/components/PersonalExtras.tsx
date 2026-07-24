import type { JSX } from "preact";
import { Money, SectionCard } from "./wallet-bits.tsx";
import { IncomeSmootherCard } from "./IncomeSmootherCard.tsx";
import { WalletIcon } from "./wallet-glyphs.tsx";
import type { PersonalExtras as PersonalExtrasData } from "../types/wallet-types.ts";

/**
 * PersonalExtras — the personal Overview's variant block. A freelancer earner sees the Income Smoother,
 * a tax set-aside pot, and projected income from capital locked on active stages; an individual client
 * sees their funding source + spend-this-month (no earner cards). Pure; the freelancer branch takes an
 * `onEnrol` the island wires to the enrolment modal.
 */
export interface PersonalExtrasProps {
	data: PersonalExtrasData;
	onEnrolSmoother?: () => void;
}

export function PersonalExtras({ data, onEnrolSmoother }: PersonalExtrasProps): JSX.Element {
	// Client branch — funding + spend, no earner cards.
	if (!data.incomeSmoother && (data.fundingSource || data.spentThisMonth)) {
		return (
			<div class="wallet-extras">
				<SectionCard title="This month" class="wallet-extras__card">
					{data.spentThisMonth && (
						<div class="wallet-figure">
							<span class="wallet-figure__label">Spent</span>
							<Money value={data.spentThisMonth} class="wallet-figure__value" />
						</div>
					)}
					{data.fundingSource && (
						<p class="wallet-extras__source">
							<WalletIcon name="card" size={16} /> Funding via {data.fundingSource}
						</p>
					)}
				</SectionCard>
			</div>
		);
	}

	// Freelancer branch — smoother + tax pot + projected.
	return (
		<div class="wallet-extras">
			{data.incomeSmoother && (
				<IncomeSmootherCard state={data.incomeSmoother} onEnrol={onEnrolSmoother} />
			)}
			<div class="wallet-extras__row">
				{data.taxPot && (
					<SectionCard title="Tax set-aside" class="wallet-extras__card">
						<div class="wallet-figure">
							<Money value={data.taxPot.balance} class="wallet-figure__value" />
							<span class="wallet-figure__sub">
								Auto {(data.taxPot.autoAllocateBp / 100).toFixed(0)}% of each payout
							</span>
						</div>
					</SectionCard>
				)}
				{data.projectedFromLocked && (
					<SectionCard title="Projected income" class="wallet-extras__card">
						<div class="wallet-figure">
							<Money value={data.projectedFromLocked} class="wallet-figure__value" />
							<span class="wallet-figure__sub">From capital locked on active stages</span>
						</div>
					</SectionCard>
				)}
			</div>
		</div>
	);
}
