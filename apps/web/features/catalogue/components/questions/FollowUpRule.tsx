import type { JSX } from "preact";
import { MultiSelect, SelectButton } from "@projective/ui/fields";
import {
	conditionAnswers,
	type IntakeCondition,
	type IntakeField,
} from "@projective/types/services";

/** Props for {@link FollowUpRule}. */
export interface FollowUpRuleProps {
	field: IntakeField;
	condition: IntakeCondition;
	/** The question this one follows. */
	parent: IntakeField;
	position: number;
	/** Published: when a follow-up is asked is fixed (Decision #522). */
	locked: boolean;
	onChange: (condition: IntakeCondition) => void;
}

const EFFECTS = [{ label: "Ask", value: "show" }, { label: "Skip", value: "hide" }];

/**
 * FollowUpRule — when a follow-up is asked: on the answers it follows from the question above it
 * (Yes or No, or any of the options), asked on a match or skipped on one. The question it follows is
 * the one it hangs under in the builder, so only the answers are chosen here.
 */
export function FollowUpRule(props: FollowUpRuleProps): JSX.Element {
	const { condition, parent, position, locked, onChange } = props;
	const parentName = parent.label.trim() || "the question above";
	return (
		<div class="cat-qb__rule" role="group" aria-label={`Question ${position}: when it is asked`}>
			<SelectButton
				aria-label={`Question ${position}: ask or skip`}
				value={condition.effect}
				options={EFFECTS}
				disabled={locked}
				onValueChange={(v) =>
					onChange({ ...condition, effect: v === "hide" ? "hide" : "show" })}
			/>
			<span class="cat-qb__rule-text">when “{parentName}” is answered</span>
			{parent.kind === "boolean"
				? (
					<SelectButton
						aria-label={`Question ${position}: the answer it follows`}
						value={condition.anyOf[0] === false ? "no" : "yes"}
						options={[{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]}
						disabled={locked}
						onValueChange={(v) => onChange({ ...condition, anyOf: [v !== "no"] })}
					/>
				)
				: (
					<MultiSelect
						aria-label={`Question ${position}: the answers it follows`}
						value={condition.anyOf.filter((v): v is string => typeof v === "string")}
						options={conditionAnswers(parent).map((a) => ({
							label: a.label,
							value: String(a.value),
						}))}
						display="chip"
						disabled={locked}
						onValueChange={(v) => {
							if (v.length > 0) {
								onChange({ ...condition, anyOf: v });
							}
						}}
					/>
				)}
		</div>
	);
}
