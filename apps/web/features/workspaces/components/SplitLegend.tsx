import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { MetaLine } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import type { SplitStake } from "@projective/types/workspace";
import { legendItems } from "../core/payout-model.ts";
import { cloneGlyph } from "../core/workspace-glyphs.tsx";
import { HoldGlyph } from "./policy-glyphs.tsx";

/**
 * SplitLegend — the record under the Member stakes bar.
 *
 * The bar is the overview; this is what a reader who cannot compare widths reads. Each member's share
 * is a MetaLine fact in tabular figures (two decimals, the stored basis points exactly), a held stake
 * marked "held" in words rather than by a hatch alone. Under it, one two-state toggle per member holds
 * or releases their stake: a held stake's dividers lock, so moving the others can never change it, and
 * a departure rebalance never redistributes it (`finance.contribution_agreements.held`).
 *
 * Each toggle is a tier-5 text Button with `aria-pressed` — the unfilled two-state toggle §C.1 sanctions
 * (the footer rig's Org chart toggle): engaged, it takes the solid `--surface-2` step with
 * `--on-surface` ink and shows the hold mark. A repeated action is never filled (§B.8.2), so holding a
 * stake never adds a filled control beside the rig's Save.
 *
 * The hold mark's slot is always laid out and only painted while the stake is held, so a press changes
 * no toggle's width and never moves the toggles after it.
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

/**
 * One member's hold toggle: pressed while the stake is held, the hold mark painted only then — in a slot
 * that is there either way, so the toggle keeps its width.
 */
function HoldToggle(props: HoldToggleProps): JSX.Element {
	const { stake } = props;
	const glyph = useMemo(() => cloneGlyph(HoldGlyph), []);
	return (
		<Button
			variant="text"
			severity="secondary"
			size="sm"
			icon={
				<span class="wsp-stakes__hold-mark" data-held={stake.held ? "true" : "false"}>
					{glyph}
				</span>
			}
			label={stake.name}
			aria-pressed={stake.held}
			aria-label={`Hold ${stake.name}'s stake`}
			disabled={props.disabled}
			onClick={() => props.onToggle(!stake.held)}
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
