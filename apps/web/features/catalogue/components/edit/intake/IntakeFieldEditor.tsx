import type { JSX } from "preact";
import { useSortable } from "@projective/ui/dnd";
import {
	InputText,
	MoneyInput,
	MultiSelect,
	NumberStepper,
	Select,
	SelectButton,
	ToggleSwitch,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	conditionAnswers,
	conditionSources,
	type IntakeCondition,
	type IntakeField,
	IntakeFieldKind,
} from "@projective/types/services";
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
	/** The questions above this one: what it may follow (Decision #522). */
	earlier: readonly IntakeField[];
	/** The listing's currency, which a number question's guide pricing is in. */
	currency: string;
	onChange: (field: IntakeField) => void;
	onRemove: () => void;
}

/**
 * IntakeFieldEditor — one buyer question: its wording, its kind, whether it must be answered, a
 * one-line hint, and what its kind needs (options for a choice; bounds, a unit, a starting value and
 * linear guide pricing for a number; a placeholder for text). Any question below a yes/no or a choice
 * may be a follow-up to it: asked only when (or unless) that question is answered a given way
 * (Decision #522). Locked once the listing has been published, when only the wording, the options,
 * the starting value and the pricing stay editable.
 */
export function IntakeFieldEditor(props: IntakeFieldEditorProps): JSX.Element {
	const { index, field, locked, onChange } = props;
	const sources = conditionSources(props.earlier);
	const source = field.condition
		? props.earlier.find((f) => f.id === field.condition?.fieldId) ?? null
		: null;
	const setCondition = (next: IntakeCondition | undefined) => onChange({ ...field, condition: next });
	const unitWord = field.unit ? field.unit.replace(/s$/, "") : "unit";
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

			{field.kind === "number" && (
				<div class="cat-offer__row">
					<div class="cat-sec__field">
						<label class="cat-sec__label" for={`${base}-start`}>Starting value</label>
						<div class="cat-offer__compact">
							<NumberStepper
								id={`${base}-start`}
								value={field.defaultValue ?? null}
								min={field.min}
								max={field.max}
								onValueChange={(v) => patch({ defaultValue: v ?? undefined })}
							/>
						</div>
					</div>
					<div class="cat-sec__field cat-intake__required">
						<ToggleSwitch
							value={!!field.pricing}
							onValueChange={(on) =>
								patch({
									pricing: on
										? {
											model: "linear",
											perUnitMinor: field.pricing?.perUnitMinor ?? 0,
											includedUnits: field.pricing?.includedUnits ?? 0,
										}
										: undefined,
								})}
							label="Adjusts your guide price"
						/>
					</div>
					{field.pricing && (
						<>
							<div class="cat-sec__field">
								<label class="cat-sec__label" for={`${base}-perunit`}>Per {unitWord}</label>
								<MoneyInput
									id={`${base}-perunit`}
									value={field.pricing.perUnitMinor}
									currency={props.currency}
									onValueChange={(minor) =>
										field.pricing && patch({ pricing: { ...field.pricing, perUnitMinor: minor ?? 0 } })}
								/>
							</div>
							<div class="cat-sec__field">
								<label class="cat-sec__label" for={`${base}-included`}>Included</label>
								<div class="cat-offer__compact">
									<NumberStepper
										id={`${base}-included`}
										value={field.pricing.includedUnits}
										min={0}
										onValueChange={(v) =>
											field.pricing &&
											patch({ pricing: { ...field.pricing, includedUnits: Math.max(0, v ?? 0) } })}
									/>
								</div>
							</div>
						</>
					)}
				</div>
			)}
			{field.kind === "number" && field.pricing && (
				<p class="cat-sec__hint">
					Each {unitWord} past the included amount moves the guide buyers see by this much, up or down. It
					guides a quote; the price you send is the one charged.
				</p>
			)}

			{(sources.length > 0 || field.condition) && (
				<div class="cat-intake__followup">
					<ToggleSwitch
						value={!!field.condition}
						onValueChange={(on) => {
							const first = sources[0];
							setCondition(
								on && first
									? { fieldId: first.id, anyOf: [conditionAnswers(first)[0].value], effect: "show" }
									: undefined,
							);
						}}
						label="Ask this only when an earlier answer matches"
						disabled={locked}
					/>
					{field.condition && (
						<div class="cat-offer__row">
							<div class="cat-sec__field">
								<span class="cat-sec__label">Show or hide</span>
								<SelectButton
									aria-label={`Question ${position}: show or hide`}
									value={field.condition.effect}
									options={[{ label: "Show", value: "show" }, { label: "Hide", value: "hide" }]}
									disabled={locked}
									onValueChange={(v) =>
										field.condition &&
										setCondition({ ...field.condition, effect: v === "hide" ? "hide" : "show" })}
								/>
							</div>
							<div class="cat-sec__field">
								<label class="cat-sec__label" for={`${base}-source`}>When</label>
								<Select
									id={`${base}-source`}
									value={field.condition.fieldId}
									options={sources.map((s) => ({
										label: s.label.trim() || `Question ${props.earlier.indexOf(s) + 1}`,
										value: s.id,
									}))}
									disabled={locked}
									onValueChange={(v) => {
										const next = sources.find((s) => s.id === v);
										if (next && field.condition) {
											setCondition({
												...field.condition,
												fieldId: next.id,
												anyOf: [conditionAnswers(next)[0].value],
											});
										}
									}}
								/>
							</div>
							{source && (
								<div class="cat-sec__field">
									<span class="cat-sec__label">is answered</span>
									{source.kind === "boolean"
										? (
											<SelectButton
												aria-label={`Question ${position}: the answer it follows`}
												value={field.condition.anyOf[0] === false ? "no" : "yes"}
												options={[{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]}
												disabled={locked}
												onValueChange={(v) =>
													field.condition &&
													setCondition({ ...field.condition, anyOf: [v !== "no"] })}
											/>
										)
										: (
											<MultiSelect
												aria-label={`Question ${position}: the answers it follows`}
												value={field.condition.anyOf.filter((v): v is string => typeof v === "string")}
												options={conditionAnswers(source).map((a) => ({
													label: a.label,
													value: String(a.value),
												}))}
												display="chip"
												disabled={locked}
												onValueChange={(v) => {
													if (field.condition && v.length > 0) setCondition({ ...field.condition, anyOf: v });
												}}
											/>
										)}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</li>
	);
}
