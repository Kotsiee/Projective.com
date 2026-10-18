import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Button, SplitBar } from "@projective/ui/fields";
import { splitDriftBp, type SplitStake } from "@projective/types/workspace";
import type { SplitSegment } from "@ui/fields/core/split-bar-model.ts";
import {
	canRestoreWhole,
	driftSentence,
	offersRebalance,
	segmentsOf,
} from "../core/payout-model.ts";
import { SplitLegend } from "./SplitLegend.tsx";

/**
 * MemberStakesSection — the Payouts module's "Member stakes": one `SplitBar` segment per active member
 * (the ui control owns the 10 000 bp invariant, the held locks and the keyboard), the tabular legend
 * with a hold toggle per member, and — under Co-op's equal shape — a "Split evenly" text action.
 *
 * The bar cannot make a split that misses 100%, but the server can hand one over (a member left and
 * their share was not spread). That drift is stated in an InlineNotice whose one action rebalances
 * the unheld stakes in proportion — never a tinted box, and never a Save that can only fail. When the
 * holds leave nothing to rebalance, the notice offers no action and says to release a hold instead.
 */

// #region Props
export interface MemberStakesSectionProps {
	stakes: readonly SplitStake[];
	/** The reader may edit (manage_finances, team not archived). */
	editable: boolean;
	/** The split as the bar changed it. */
	onSegments: (next: readonly SplitSegment[]) => void;
	onToggleHold: (memberId: string, held: boolean) => void;
	/** Restore a drifted split to 100%. */
	onRebalance: () => void;
	/** Split the unheld stakes evenly, or `null` when they already are. */
	onEven: (() => void) | null;
}
// #endregion

// #region Component
export function MemberStakesSection(props: MemberStakesSectionProps): JSX.Element {
	const drift = splitDriftBp(props.stakes);
	const restorable = canRestoreWhole(props.stakes);
	const rebalance = offersRebalance(props.stakes, props.editable);
	return (
		<section class="wsp-payout__section" aria-labelledby="wsp-payout-stakes">
			<div class="wsp-payout__head">
				<h2 class="wsp-band__title" id="wsp-payout-stakes">Member stakes</h2>
				<p class="wsp-payout__meta">
					How the members' share divides. Drag a divider, or focus one and use the arrow keys — the
					stakes always total 100%, and a held stake stays where it is.
				</p>
			</div>

			{drift !== 0 && (
				<InlineNotice
					align="start"
					class="wsp-payout__notice"
					actionLabel={rebalance ? "Rebalance to 100%" : undefined}
					onAction={rebalance ? props.onRebalance : undefined}
				>
					{driftSentence(drift, restorable)}
				</InlineNotice>
			)}

			<SplitBar
				aria-label="Member stakes"
				value={segmentsOf(props.stakes)}
				onValueChange={(next) => props.onSegments(next)}
				readOnly={!props.editable}
				legend={false}
			/>

			<SplitLegend
				stakes={props.stakes}
				readOnly={!props.editable}
				onToggleHold={props.onToggleHold}
			/>

			{props.editable && props.onEven && (
				<div class="wsp-payout__actions">
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						label="Split evenly"
						onClick={props.onEven}
					/>
				</div>
			)}
		</section>
	);
}
// #endregion
