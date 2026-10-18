import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { EmptyState } from "@projective/ui/utils";
import type { RosterControl, RosterEmptyCopy, RosterFirstRunCopy } from "../core/roster-model.ts";
import { tierProps } from "../core/create-model.ts";
import { cloneGlyph, MembersGlyph, PlusGlyph, SearchGlyph } from "../core/workspace-glyphs.tsx";

/**
 * RosterEmpty — the two empty states of `/teams` and `/businesses`, both the ui `EmptyState` (the
 * `/projects` portfolio's own), never a hand-built block (Teams work order R1).
 *
 * They are different things and must not borrow from each other:
 *
 *   - {@link RosterFirstRun} — the viewer has no entity of this kind and nothing to answer. It says
 *     what one IS in one sentence from PRODUCT_SPEC and holds the page's ONE structural commit, the
 *     tier-2 create; the lane's footer withholds its own create meanwhile (`lane-model.ts`), so the
 *     page never offers two. When the plan admits none, the sentence carries the plan's reason and no
 *     button is drawn — never a dead control.
 *   - {@link RosterFiltered} — a partition or a search left nothing. Somebody who has just filtered
 *     does not need to be told what a team is; they need to know the filter matched nothing and how to
 *     get back — a tier-5 Clear filters, and no create.
 *
 * Both are presentational: the words and the controls (with their tiers) come from `roster-model.ts`,
 * and every Button spreads `tierProps(tier)`, so the tier the model assigns is the tier on screen.
 */

// #region First run
export interface RosterFirstRunProps {
	/** The words (`rosterFirstRunCopy`) — the plan's reason already folded into the description. */
	copy: RosterFirstRunCopy;
	/** The structural create, or `null` when the plan admits no entity of this kind. */
	create: RosterControl | null;
	/** Open the Draft-First create modal. */
	onCreate: () => void;
}

/** The first-run state: what the entity is, and the one way to make one. */
export function RosterFirstRun(props: RosterFirstRunProps): JSX.Element {
	const { copy, create } = props;
	return (
		<EmptyState
			class="wsp-roster__empty"
			size="lg"
			icon={cloneGlyph(MembersGlyph)}
			title={copy.title}
			description={copy.description}
			actions={create && (
				<Button
					{...tierProps(create.tier)}
					label={create.label}
					icon={cloneGlyph(PlusGlyph)}
					onClick={props.onCreate}
				/>
			)}
		/>
	);
}
// #endregion

// #region Filtered to nothing
export interface RosterFilteredProps {
	/** The words (`rosterEmptyCopy`). */
	copy: RosterEmptyCopy;
	/** The tier-5 Clear filters, or `null` when nothing is filtered. */
	clear: RosterControl | null;
	/** Return to every entity: the All partition and no search term. */
	onClear: () => void;
}

/** A partition or a search that left nothing — what happened, and the way back. */
export function RosterFiltered(props: RosterFilteredProps): JSX.Element {
	const { copy, clear } = props;
	return (
		<EmptyState
			class="wsp-roster__empty"
			size="sm"
			icon={cloneGlyph(SearchGlyph)}
			title={copy.title}
			description={copy.description}
			actions={clear && (
				<Button {...tierProps(clear.tier)} label={clear.label} onClick={props.onClear} />
			)}
		/>
	);
}
// #endregion
