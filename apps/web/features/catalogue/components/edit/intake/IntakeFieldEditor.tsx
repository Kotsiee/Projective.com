import type { JSX } from "preact";
import { useSortable } from "@projective/ui/dnd";
import { InputText, NumberStepper, Select, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { type IntakeField, IntakeFieldKind } from "@projective/types/services";
import { hasOptions, INTAKE_KIND_LABELS, withKind } from "../../../core/intake-model.ts";
import { IntakeOptionsEditor } from "./IntakeOptionsEditor.tsx";

const KIND_OPTIONS = IntakeFieldKind.options.map((value) => ({
	label: INTAKE_KIND_LABELS[value],
	value,
}));

/** The drag id of question `index`. */
export const questionDragId = (index: number) => `question:${index}`;

/** Props for {@link IntakeFieldEditor}. */
export interface IntakeFieldEditorProps {
	index: number;
	field: IntakeField;
	/** Published: only the wording and the options may change. */
	locked: boolean;
	problem: string | null;
	onChange: (field: IntakeField) => void;
	onRemove: () => void;
}

/**
 * IntakeFieldEditor — one buyer question: its wording, its kind, whether it must be answered, a
 * one-line hint, and what its kind needs (options for a choice, bounds and a unit for a number, a
 * placeholder for text). Locked once the listing has been published, when only the wording and the
 * options stay editable.
 */
export function IntakeFieldEditor(props: IntakeFieldEditorProps): JSX.Element {
	const { index, field, locked, onChange } = props;
	const position = index + 1;
	const base = `cat-intake-${field.id}`;
	const sortable = useSortable({
		id: questionDragId(index),
		data: { type: "question", accepts: ["question"] },
		roleDescription: "question",
		disabled: locked,
	});
	const name = field.label.trim() || `Question ${position}`;
	const patch = (next: Partial<IntakeField>) => onChange({ ...field, ...next });

	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="cat-intake__question"
			data-dragging={sortable.isDragging.value || undefined}
		>
			<div class="cat-offer__step-head">
				{!locked && (
					<button
						type="button"
						class="cat-offer__grip"
						aria-label={`Reorder ${name}`}
						aria-roledescription={sortable.attributes["aria-roledescription"]}
						tabIndex={sortable.attributes.tabIndex}
						onPointerDown={sortable.listeners.onPointerDown}
						onKeyDown={sortable.listeners.onKeyDown}
					>
						<Icon name="grip" size="xs" />
					</button>
				)}
				<span class="cat-intake__number" aria-hidden="true">{position}</span>
				<InputText
					id={`${base}-label`}
					value={field.label}
					onValueChange={(label) => patch({ label })}
					maxLength={120}
					placeholder="Ask the buyer something"
					aria-label={`Question ${position}`}
					aria-describedby={props.problem ? `${base}-problem` : undefined}
					status={props.problem ? "invalid" : "default"}
					fluid
				/>
				{!locked && (
					<button
						type="button"
						class="cat-offer__remove"
						aria-label={`Remove ${name}`}
						onClick={props.onRemove}
					>
						<Icon name="close" size="2xs" />
					</button>
				)}
			</div>
			{props.problem && <p class="cat-offer__problem" id={`${base}-problem`}>{props.problem}</p>}

			<div class="cat-offer__row">
				<div class="cat-sec__field">
					{locked
						? <span class="cat-sec__label">Answer</span>
						: <label class="cat-sec__label" for={`${base}-kind`}>Answer</label>}
					{locked ? <p class="cat-sec__value">{INTAKE_KIND_LABELS[field.kind]}</p> : (
						<Select
							id={`${base}-kind`}
							options={KIND_OPTIONS}
							value={field.kind}
							onValueChange={(v) => {
								const kind = IntakeFieldKind.safeParse(v);
								if (kind.success) onChange(withKind(field, kind.data));
							}}
						/>
					)}
				</div>
				<div class="cat-sec__field cat-intake__required">
					<ToggleSwitch
						value={field.required}
						onValueChange={(required) => patch({ required })}
						label="Required"
						disabled={locked}
					/>
				</div>
			</div>

			<InputText
				value={field.hint ?? ""}
				onValueChange={(hint) => patch({ hint: hint.trim() ? hint : undefined })}
				maxLength={240}
				placeholder="A hint under the question (optional)"
				aria-label={`Question ${position} hint`}
				fluid
			/>

			{hasOptions(field.kind) && (
				<>
					<IntakeOptionsEditor field={field} position={position} onChange={onChange} />
					{field.kind === "pills" && (
						<ToggleSwitch
							value={field.multiple}
							onValueChange={(multiple) => patch({ multiple })}
							label="Buyers may pick more than one"
							disabled={locked}
						/>
					)}
				</>
			)}

			{(field.kind === "text" || field.kind === "textarea") && (
				<InputText
					value={field.placeholder ?? ""}
					onValueChange={(placeholder) =>
						patch({ placeholder: placeholder.trim() ? placeholder : undefined })}
					maxLength={120}
					placeholder="Example answer shown in the box (optional)"
					aria-label={`Question ${position} example answer`}
					fluid
				/>
			)}

			{field.kind === "number" && (
				<div class="cat-offer__row">
					<div class="cat-sec__field">
						<label class="cat-sec__label" for={`${base}-min`}>Lowest</label>
						<div class="cat-offer__compact">
							<NumberStepper
								id={`${base}-min`}
								value={field.min ?? null}
								onValueChange={(min) => patch({ min: min ?? undefined })}
								disabled={locked}
							/>
						</div>
					</div>
					<div class="cat-sec__field">
						<label class="cat-sec__label" for={`${base}-max`}>Highest</label>
						<div class="cat-offer__compact">
							<NumberStepper
								id={`${base}-max`}
								value={field.max ?? null}
								onValueChange={(max) => patch({ max: max ?? undefined })}
								disabled={locked}
							/>
						</div>
					</div>
					<div class="cat-sec__field">
						<label class="cat-sec__label" for={`${base}-unit`}>Unit</label>
						<InputText
							id={`${base}-unit`}
							value={field.unit ?? ""}
							onValueChange={(unit) => patch({ unit: unit.trim() ? unit : undefined })}
							maxLength={24}
							placeholder="words"
							disabled={locked}
						/>
					</div>
					<div class="cat-sec__field cat-intake__required">
						<ToggleSwitch
							value={field.slider}
							onValueChange={(slider) => patch({ slider })}
							label="Offer a slider"
							disabled={locked}
						/>
					</div>
				</div>
			)}
		</li>
	);
}
