import type { JSX } from "preact";
import { TagCombobox } from "@projective/ui/fields";
import { WorkspaceService } from "../../../core/WorkspaceService.ts";
import { STAGE_LIST_MAX } from "../../../core/offer-model.ts";

async function suggestSkills(q: string): Promise<string[]> {
	const res = await WorkspaceService.skills(q);
	if (!res.ok || !res.data) throw new Error(res.message ?? "Skills aren't available right now.");
	return res.data.skills.map((s) => s.label);
}

/** Props for {@link SkillTags}. */
export interface SkillTagsProps {
	id: string;
	/** The skill labels as the seller wrote them. */
	value: readonly string[];
	onChange: (skills: string[]) => void;
	/** Names the field when no visible label points at {@link id}. */
	"aria-label"?: string;
}

/**
 * SkillTags — the skill labels a stage or team role needs, as a tag combobox suggesting `org.skills`
 * labels (the Basics skills typeahead's source). Stored as labels, at most twelve.
 */
export function SkillTags(props: SkillTagsProps): JSX.Element {
	return (
		<TagCombobox
			id={props.id}
			value={[...props.value]}
			onValueChange={props.onChange}
			suggest={suggestSkills}
			max={STAGE_LIST_MAX}
			maxLength={60}
			placeholder="Add a skill"
			aria-label={props["aria-label"]}
			fluid
		/>
	);
}
