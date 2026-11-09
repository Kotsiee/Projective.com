import type { JSX } from "preact";
import { useId } from "@projective/ui/hooks";
import { ACCESS_TIERS, type AccessContainer, type AssetVisibility } from "@projective/types/files";
import { VisibilityMark } from "@features/files/components/file-hub-glyphs.tsx";
import { tierLabel, tierNote } from "../../core/access-draft.ts";

/** Props for {@link TierChoice}. */
export interface TierChoiceProps {
	value: AssetVisibility;
	/** The library, with the draft's member switch applied, so Private names who still opens it. */
	container: AccessContainer;
	/** The owner chooses; anyone else reads the tier as text. */
	editable: boolean;
	onChange: (tier: AssetVisibility) => void;
	disabled?: boolean;
}

/**
 * The file's tier as four native radios, least to most reachable, each saying what it means for this
 * file. For anyone but the owner it is the chosen tier as a fact, with no control beside it.
 */
export function TierChoice(
	{ value, container, editable, onChange, disabled }: TierChoiceProps,
): JSX.Element {
	const name = useId(undefined, "ins-access-tier");

	if (!editable) {
		return (
			<div class="ins-access__group">
				<h3 class="ins-access__subtitle">Who can open it</h3>
				<p class="ins-access__fact">
					<span class="ins-access__glyph" aria-hidden="true">
						<VisibilityMark visibility={value} />
					</span>
					{tierLabel(value, container, false)}
				</p>
				<p class="ins-access__note">{tierNote(value, container, false)}</p>
				<p class="ins-access__note">Only the owner can change this.</p>
			</div>
		);
	}

	return (
		<fieldset class="ins-access__group ins-access__tiers" disabled={disabled}>
			<legend class="ins-access__subtitle">Who can open it</legend>
			{ACCESS_TIERS.map((tier) => {
				const chosen = tier === value;
				const noteId = `${name}-${tier}`;
				return (
					<label key={tier} class="ins-access__tier" data-chosen={chosen ? "true" : undefined}>
						<input
							type="radio"
							class="ins-access__tier-input"
							name={name}
							value={tier}
							checked={chosen}
							aria-describedby={noteId}
							onChange={() => onChange(tier)}
						/>
						<span class="ins-access__tier-label">
							<span class="ins-access__glyph" aria-hidden="true">
								<VisibilityMark visibility={tier} />
							</span>
							{tierLabel(tier, container, true)}
						</span>
						<span class="ins-access__tier-note" id={noteId}>
							{tierNote(tier, container, true)}
						</span>
					</label>
				);
			})}
		</fieldset>
	);
}
