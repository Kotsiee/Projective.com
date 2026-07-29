import type { JSX } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { Money } from "./Money.tsx";
import type { MoneyView, PersonalExtras } from "../types/wallet-types.ts";

/**
 * PotsPanel — the personal wallet's set-asides and its spend context.
 *
 * Two audiences share this slot, and each only ever sees its own fields:
 *  - a **freelancer** gets the tax pot and the income projected from capital currently locked in
 *    escrow — the two numbers that answer "how much of this is actually mine to spend";
 *  - a **client** has neither, so it gets the funding source and the month's spend instead.
 *
 * Any block whose field is `null` is OMITTED rather than rendered empty: a labelled zero the server
 * never sent is an invented figure, and on a finance surface that is worse than a shorter panel.
 */
export interface PotsPanelProps {
	taxPot: PersonalExtras["taxPot"];
	projectedFromLocked: MoneyView | null;
	fundingSource: string | null;
	spentThisMonth: MoneyView | null;
}

export function PotsPanel(props: PotsPanelProps): JSX.Element | null {
	const { taxPot, projectedFromLocked, fundingSource, spentThisMonth } = props;
	if (!taxPot && !projectedFromLocked && !fundingSource && !spentThisMonth) return null;

	return (
		<section class="wlt-pots" aria-labelledby="wlt-pots-title">
			<h3 class="wlt-pots__title wlt-label" id="wlt-pots-title">
				{taxPot || projectedFromLocked ? "Set aside" : "This month"}
			</h3>

			{taxPot && (
				<div class="wlt-pots__item">
					<span class="wlt-pots__label">{taxPot.name}</span>
					<span class="wlt-pots__value">
						<Money value={taxPot.balance} size="figure" showFx={false} />
					</span>
					<span class="wlt-pots__rule">
						Auto {(taxPot.autoAllocateBp / 100).toFixed(0)}% of each payout
					</span>
					<span
						class="wlt-pots__bar"
						style={styleVars({ "--wlt-fill": `${Math.min(100, taxPot.autoAllocateBp / 100)}%` })}
						aria-hidden="true"
					>
						<span class="wlt-pots__fill" />
					</span>
				</div>
			)}

			{projectedFromLocked && (
				<div class="wlt-pots__item">
					<span class="wlt-pots__label">Projected income</span>
					<span class="wlt-pots__value">
						<Money value={projectedFromLocked} size="figure" showFx={false} />
					</span>
					<span class="wlt-pots__rule">From capital locked on active stages</span>
				</div>
			)}

			{spentThisMonth && (
				<div class="wlt-pots__item">
					<span class="wlt-pots__label">Spent</span>
					<span class="wlt-pots__value">
						<Money value={spentThisMonth} size="figure" showFx={false} />
					</span>
					{fundingSource && <span class="wlt-pots__rule">Funded via {fundingSource}</span>}
				</div>
			)}
		</section>
	);
}
