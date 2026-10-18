import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import { MetaLine } from "@projective/ui/display";
import { ToggleButton } from "@projective/ui/fields";
import type { SplitStake } from "@projective/types/workspace";
import { legendItems } from "../core/payout-model.ts";
import { cloneGlyph } from "../core/workspace-glyphs.tsx";
import { HoldGlyph } from "./policy-glyphs.tsx";

/**
 * SplitLegend — the record under the Member stakes bar.
 *
 * The bar is the overview; this is what a reader who cannot compare widths reads. Each member's share
 * is a MetaLine fact in tabular figures (two decimals, the stored basis points exactly), a held stake
 * marked "held" in words rather than by a hatch alone. Under it, one ToggleButton per member holds or
 * releases their stake: a held stake's dividers lock, so moving the others can never change it, and a
 * departure rebalance never redistributes it (`finance.contribution_agreements.held`).
 *
 * The toggles' pressed state is bound to the stakes it is handed — a Discard or a save that changes
 * `held` re-seeds the bound signal rather than remounting the control, so focus stays where it was.
 */

// #region Props
export interface SplitLegendProps {
	/** The draft stakes, in the order the bar renders them. */
	stakes: readonly SplitStake[];
	/** Hold or release a stake. Absent (or `readOnly`) renders the toggles disabled. */
	onToggleHold?: (memberId: string, held: boolean) => void;
	/** A reader who may not edit, or an archived team. */
	readOnly?: boolean;
}
// #endregion

// #region Hold toggle
interface HoldToggleProps {
	stake: SplitStake;
	disabled: boolean;
	onToggle: (held: boolean) => void;
}

/** One member's hold toggle, bound to a signal re-seeded whenever the stake's `held` changes. */
function HoldToggle(props: HoldToggleProps): JSX.Element {
	const { stake } = props;
	const bound = useMemo(() => signal(stake.held), [stake.held]);
	const glyph = useMemo(() => cloneGlyph(HoldGlyph), []);
	return (
		<ToggleButton
			value={bound}
			onValueChange={props.onToggle}
			onLabel={stake.name}
			offLabel={stake.name}
			onIcon={glyph}
			size="sm"
			disabled={props.disabled}
			aria-label={`Hold ${stake.name}'s stake`}
		/>
	);
}
// #endregion

// #region Component
/** The stakes as a tabular MetaLine, then the hold toggles. */
export function SplitLegend(props: SplitLegendProps): JSX.Element {
	const { stakes, readOnly = false } = props;
	const disabled = readOnly || !props.onToggleHold;
	return (
		<div class="wsp-stakes__legend">
			<MetaLine items={legendItems(stakes)} />
			<div class="wsp-stakes__holds" role="group" aria-label="Hold a stake">
				<span class="wsp-stakes__holds-label" aria-hidden="true">Hold</span>
				{stakes.map((stake) => (
					<HoldToggle
						key={stake.memberId}
						stake={stake}
						disabled={disabled}
						onToggle={(held) => props.onToggleHold?.(stake.memberId, held)}
					/>
				))}
			</div>
		</div>
	);
}
// #endregion
