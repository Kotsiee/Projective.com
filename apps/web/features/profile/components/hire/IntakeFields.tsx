import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import {
	Checkbox,
	FormControl,
	InputNumber,
	InputText,
	MultiSelect,
	type Option,
	RadioGroup,
	Select,
	SelectButton,
	Slider,
	Textarea,
	ToggleSwitch,
} from "@projective/ui/fields";
import type {
	IntakeAnswer,
	IntakeAnswers,
	IntakeField,
	IntakeRefusal,
} from "@projective/types/services";
import { INTAKE_TEXT_MAX, isMultiChoice } from "@projective/types/services";

/**
 * IntakeFields — the dynamic renderer for a seller's own requirements: one `@projective/ui`
 * control per {@link IntakeField.kind}, wired to one answers signal.
 *
 * It is a RENDERER, not a form. The field list is seller-authored data and arrives on the listing
 * (`ServiceView.intake`) or the profile (`ProfileView.hireIntake`); this component maps each kind
 * onto the control that already exists for it and reads the answer back into the record the write
 * payload carries. The rule for whether an answer is acceptable lives in the SSOT
 * (`intakeRefusal`) and is called by the MODAL, which passes the one refusal down as `refusal` so
 * the offending control paints invalid and its sentence appears beneath it — never the whole form
 * lit red at once.
 *
 * Kind → control:
 *  - `text` → `InputText` · `textarea` → `Textarea`
 *  - `number` → `InputNumber`, plus a `Slider` when the seller set both bounds and asked for one
 *  - `boolean` → `ToggleSwitch`
 *  - `select` → `Select` · `multiselect` → `MultiSelect`
 *  - `radio` → `RadioGroup` · `pills` → `SelectButton` (single or `multiple`) · `checkboxes` → a
 *    labelled group of `Checkbox`es
 *
 * Every control is labelled through `FormControl`, so "label in name" (WCAG 2.5.3) holds for all
 * nine kinds, and a required field carries the asterisk the wrapper draws rather than one typed
 * into the label.
 */
export interface IntakeFieldsProps {
	fields: readonly IntakeField[];
	/** The answers, keyed by field id. Written in place on every change. */
	answers: Signal<IntakeAnswers>;
	/** The one refusal to paint, or `null`. Produced by the modal from the SSOT's own rule. */
	refusal: IntakeRefusal | null;
	disabled?: boolean;
	/** A prefix for control ids, so two intake forms on one page cannot collide. */
	idPrefix: string;
}

/**
 * Move focus to the first control a refusal painted, so a keyboard user whose attempt was refused
 * lands ON the problem rather than staying on the primary they pressed. The modal calls it from an
 * effect keyed on the refused attempt — never from the click handler, because the controls write
 * `aria-invalid` on the NEXT render and a query run inside the handler finds nothing (the Decision
 * #105 ordering). A group control (radios, pills, checkboxes) carries the mark on a wrapper that is
 * not itself focusable, so the first focusable descendant takes it. Returns `false` when nothing
 * is marked — a refusal that names no field (a stage set, a server sentence) leaves focus alone
 * and lets the notice's live region carry it.
 */
export function focusFirstRefused(root: ParentNode | null | undefined): boolean {
	const marked = root?.querySelector<HTMLElement>(
		'[aria-invalid="true"], [data-refused="true"], .ui-field--invalid',
	);
	if (!marked) return false;
	const focusable =
		'input:not([type="hidden"]), textarea, select, button, [tabindex]:not([tabindex="-1"])';
	const target = marked.matches(focusable) ? marked : marked.querySelector<HTMLElement>(focusable);
	if (!target) return false;
	target.focus();
	try {
		target.scrollIntoView({ block: "nearest" });
	} catch { /* an engine without options-form scrollIntoView — focus alone is enough */ }
	return true;
}

/**
 * Once a flow has succeeded, the primary that was pressed is gone and focus would otherwise fall
 * to `<body>` — the Decision #68 defect, where a dialog restored focus to a control that no longer
 * existed. Move it onto the success state's own action (its Done button), found from the success
 * region upward so it is the SAME dialog and never a sibling overlay's.
 */
export function focusSuccessAction(region: HTMLElement | null | undefined): void {
	const dialog = region?.closest<HTMLElement>('[role="dialog"]');
	dialog?.querySelector<HTMLElement>(".pf-split__actions button, .pf-consult__actions button")
		?.focus();
}

export function IntakeFields(
	{ fields, answers, refusal, disabled, idPrefix }: IntakeFieldsProps,
): JSX.Element | null {
	if (fields.length === 0) return null;

	function set(id: string, value: IntakeAnswer): void {
		answers.value = { ...answers.value, [id]: value };
	}

	return (
		<div class="pf-intake">
			{fields.map((field) => (
				<IntakeControl
					key={field.id}
					field={field}
					answer={answers.value[field.id] ?? null}
					refused={refusal?.fieldId === field.id ? refusal.message : null}
					disabled={disabled}
					id={`${idPrefix}-${field.id}`}
					onChange={(value) => set(field.id, value)}
				/>
			))}
		</div>
	);
}

// #region One control
interface IntakeControlProps {
	field: IntakeField;
	answer: IntakeAnswer;
	refused: string | null;
	disabled?: boolean;
	id: string;
	onChange: (value: IntakeAnswer) => void;
}

function optionsOf(field: IntakeField): Option[] {
	return field.options.map((o) => ({ value: o.value, label: o.label }));
}

function IntakeControl(
	{ field, answer, refused, disabled, id, onChange }: IntakeControlProps,
): JSX.Element {
	const status = refused ? "invalid" : "default";
	const common = {
		label: field.label,
		hint: field.hint,
		error: refused ?? undefined,
		status,
		required: field.required,
		class: "pf-intake__field",
	} as const;

	switch (field.kind) {
		case "text":
			return (
				<FormControl {...common}>
					{(a) => (
						<InputText
							id={id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							value={typeof answer === "string" ? answer : ""}
							onValueChange={(v) => onChange(v)}
							placeholder={field.placeholder}
							maxLength={field.maxLength ?? INTAKE_TEXT_MAX}
							disabled={disabled}
							fluid
						/>
					)}
				</FormControl>
			);

		case "textarea":
			return (
				<FormControl {...common}>
					{(a) => (
						<Textarea
							id={id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							value={typeof answer === "string" ? answer : ""}
							onValueChange={(v) => onChange(v)}
							placeholder={field.placeholder}
							rows={3}
							maxRows={8}
							autoResize
							maxLength={field.maxLength ?? INTAKE_TEXT_MAX}
							disabled={disabled}
							fluid
						/>
					)}
				</FormControl>
			);

		case "number": {
			const bounded = field.min !== undefined && field.max !== undefined;
			const value = typeof answer === "number" ? answer : null;
			return (
				<FormControl {...common}>
					{(a) => (
						<div
							class="pf-intake__number"
							data-slider={bounded && field.slider ? "true" : undefined}
						>
							<InputNumber
								id={id}
								aria-describedby={a.describedBy}
								status={a.status}
								required={a.required}
								value={value}
								onValueChange={(v) => onChange(v)}
								min={field.min}
								max={field.max}
								step={field.step ?? 1}
								suffix={field.unit ? ` ${field.unit}` : undefined}
								disabled={disabled}
								fluid
							/>
							{bounded && field.slider && (
								<Slider
									aria-label={field.label}
									value={value ?? field.min!}
									onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
									min={field.min}
									max={field.max}
									step={field.step ?? 1}
									disabled={disabled}
									formatValue={(v) => `${v}${field.unit ? ` ${field.unit}` : ""}`}
								/>
							)}
						</div>
					)}
				</FormControl>
			);
		}

		case "boolean":
			return (
				<FormControl
					hint={field.hint}
					error={refused ?? undefined}
					status={status}
					class="pf-intake__field"
				>
					{(a) => (
						<ToggleSwitch
							id={id}
							aria-describedby={a.describedBy}
							label={field.label}
							value={answer === true}
							onValueChange={(v) => onChange(v)}
							disabled={disabled}
						/>
					)}
				</FormControl>
			);

		case "select":
			return (
				<FormControl {...common}>
					{(a) => (
						<Select
							id={id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							options={optionsOf(field)}
							value={typeof answer === "string" ? answer : ""}
							onValueChange={(v) => onChange(v || null)}
							placeholder={field.placeholder ?? "Choose one"}
							disabled={disabled}
							fluid
						/>
					)}
				</FormControl>
			);

		case "multiselect":
			return (
				<FormControl {...common}>
					{(a) => (
						<MultiSelect
							id={id}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							options={optionsOf(field)}
							value={Array.isArray(answer) ? answer : []}
							onValueChange={(v) => onChange(v)}
							placeholder={field.placeholder ?? "Choose any"}
							display="chip"
							disabled={disabled}
							fluid
						/>
					)}
				</FormControl>
			);

		case "radio":
			return (
				<FormControl {...common}>
					{(a) => (
						<RadioGroup
							id={id}
							aria-label={field.label}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							options={optionsOf(field)}
							value={typeof answer === "string" ? answer : ""}
							onValueChange={(v) => onChange(v)}
							orientation="vertical"
							disabled={disabled}
						/>
					)}
				</FormControl>
			);

		case "pills": {
			const multiple = isMultiChoice(field);
			return (
				<FormControl {...common}>
					{(a) => (
						<SelectButton
							id={id}
							aria-label={field.label}
							aria-describedby={a.describedBy}
							status={a.status}
							required={a.required}
							options={optionsOf(field)}
							multiple={multiple}
							value={multiple
								? (Array.isArray(answer) ? answer : [])
								: (typeof answer === "string" ? answer : "")}
							onValueChange={(v) => onChange(Array.isArray(v) ? v : v || null)}
							disabled={disabled}
							class="pf-intake__pills"
						/>
					)}
				</FormControl>
			);
		}

		case "checkboxes": {
			const chosen = Array.isArray(answer) ? answer : [];
			const toggle = (value: string, on: boolean) => {
				const next = on
					? [...chosen.filter((v) => v !== value), value]
					: chosen.filter((v) => v !== value);
				// Keep the seller's own option order so the answer reads the way the list does.
				onChange(field.options.map((o) => o.value).filter((v) => next.includes(v)));
			};
			return (
				<FormControl {...common}>
					{(a) => (
						<div
							id={id}
							role="group"
							aria-label={field.label}
							aria-describedby={a.describedBy}
							class="pf-intake__checks"
						>
							{field.options.map((option) => (
								<Checkbox
									key={option.value}
									label={option.label}
									value={chosen.includes(option.value)}
									onValueChange={(on) => toggle(option.value, on)}
									status={a.status}
									disabled={disabled}
								/>
							))}
						</div>
					)}
				</FormControl>
			);
		}
	}
}
// #endregion
