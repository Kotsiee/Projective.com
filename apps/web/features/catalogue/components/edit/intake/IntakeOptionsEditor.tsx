import type { JSX } from "preact";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { IntakeField } from "@projective/types/services";
import {
	INTAKE_OPTIONS_MAX,
	withOptionAdded,
	withOptionLabel,
	withOptionRemoved,
} from "../../../core/intake-model.ts";

/**
 * IntakeOptionsEditor — the options a choice question offers, one labelled row each. A label edit
 * keeps the option's stored value, so answers already given still match it.
 */
export function IntakeOptionsEditor(
	props: { field: IntakeField; position: number; onChange: (field: IntakeField) => void },
): JSX.Element {
	const { field, position, onChange } = props;
	return (
		<div class="cat-intake__options">
			<ul class="cat-intake__option-list" aria-label={`Question ${position} options`}>
				{field.options.map((option, i) => (
					<li key={option.value} class="cat-intake__option">
						<InputText
							value={option.label}
							onValueChange={(label) => onChange(withOptionLabel(field, i, label))}
							maxLength={120}
							aria-label={`Question ${position}, option ${i + 1}`}
							fluid
						/>
						{field.options.length > 1 && (
							<button
								type="button"
								class="cat-offer__remove"
								aria-label={`Remove option ${option.label || i + 1}`}
								onClick={() => onChange(withOptionRemoved(field, i))}
							>
								<Icon name="close" size="2xs" />
							</button>
						)}
					</li>
				))}
			</ul>
			{field.options.length < INTAKE_OPTIONS_MAX && (
				<Button
					label="Add option"
					icon={<Icon name="plus" size="xs" />}
					variant="text"
					size="sm"
					onClick={() => onChange(withOptionAdded(field, ""))}
				/>
			)}
		</div>
	);
}
