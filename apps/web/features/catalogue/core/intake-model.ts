import { hasBeenPublished, type ListingDetail } from "@projective/types/catalogue";
import {
	INTAKE_FIELDS_MAX,
	type IntakeField,
	type IntakeFieldKind,
	IntakeFieldsSchema,
	type IntakeOption,
	isMultiChoice,
	MULTI_CHOICE_KINDS,
	SINGLE_CHOICE_KINDS,
} from "@projective/types/services";

/**
 * intake-model — the pure rules under the Buyer questions builder (ServiceCreation.md §1.1): fresh
 * questions with ids unique in the list, kind changes that keep the question answerable, option
 * editing, the seller-side inverse of `intakeRefusal` (a question a buyer could never answer is
 * refused here, not at purchase), and the lock a published listing puts on its question ids.
 */

// #region Vocabulary
/** Each question kind as the seller picks it, in the order the picker lists them. */
export const INTAKE_KIND_LABELS: Readonly<Record<IntakeFieldKind, string>> = {
	text: "Short answer",
	textarea: "Paragraph",
	number: "Number",
	boolean: "Yes or no",
	select: "Dropdown",
	radio: "One choice",
	pills: "Chips",
	multiselect: "Dropdown, several",
	checkboxes: "Checkboxes",
};

/** The kinds a buyer answers by picking from the seller's options. */
export function hasOptions(kind: IntakeFieldKind): boolean {
	return SINGLE_CHOICE_KINDS.includes(kind) || MULTI_CHOICE_KINDS.includes(kind) ||
		kind === "pills";
}

/** The most options one question offers. */
export const INTAKE_OPTIONS_MAX = 24;
// #endregion

// #region Ids
/** The next free `q<n>` id in a list. Ids are generated, never typed, so they stay stable. */
export function nextFieldId(fields: readonly Pick<IntakeField, "id">[]): string {
	const taken = new Set(fields.map((f) => f.id));
	let n = fields.length + 1;
	while (taken.has(`q${n}`)) n += 1;
	return `q${n}`;
}

/** A stable option value from its label ("Brand guidelines" → `brand-guidelines`), unique in the list. */
export function optionValue(
	label: string,
	existing: readonly Pick<IntakeOption, "value">[],
): string {
	const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "").slice(0, 60) || "option";
	const taken = new Set(existing.map((o) => o.value));
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}
// #endregion

// #region Questions
/** A fresh question of `kind`, answerable as it stands (a choice kind starts with one option). */
export function newIntakeField(
	kind: IntakeFieldKind,
	fields: readonly Pick<IntakeField, "id">[],
): IntakeField {
	return {
		id: nextFieldId(fields),
		kind,
		label: "",
		required: false,
		options: hasOptions(kind) ? [{ value: "option-1", label: "Option 1" }] : [],
		multiple: false,
		slider: false,
	};
}

/**
 * `field` as `kind`. Facets the new kind ignores are kept (switching back restores them), and a
 * choice kind with no options gains one so the question stays answerable.
 */
export function withKind(field: IntakeField, kind: IntakeFieldKind): IntakeField {
	const options = hasOptions(kind) && field.options.length === 0
		? [{ value: "option-1", label: "Option 1" }]
		: field.options;
	return { ...field, kind, options };
}

/** `field` with an option labelled `label` appended (up to the cap). */
export function withOptionAdded(field: IntakeField, label: string): IntakeField {
	if (field.options.length >= INTAKE_OPTIONS_MAX) return field;
	const text = label.trim() || `Option ${field.options.length + 1}`;
	return {
		...field,
		options: [...field.options, { value: optionValue(text, field.options), label: text }],
	};
}

/** `field` with option `index` relabelled. Its value is kept, so stored answers still match it. */
export function withOptionLabel(field: IntakeField, index: number, label: string): IntakeField {
	return {
		...field,
		options: field.options.map((o, i) => (i === index ? { ...o, label } : o)),
	};
}

/** `field` without option `index`. */
export function withOptionRemoved(field: IntakeField, index: number): IntakeField {
	return { ...field, options: field.options.filter((_, i) => i !== index) };
}
// #endregion

// #region Checks
/** A question that could not be answered, said where it is wrong. */
export interface IntakeProblem {
	fieldId: string;
	message: string;
}

function fieldProblem(field: IntakeField, position: number): string | null {
	const name = field.label.trim() ? `"${field.label.trim()}"` : `Question ${position}`;
	if (!field.label.trim()) return `Write question ${position}.`;
	if (hasOptions(field.kind)) {
		if (field.options.length === 0) return `${name} needs at least one option.`;
		if (field.options.some((o) => !o.label.trim())) return `${name} has an option with no label.`;
		if (new Set(field.options.map((o) => o.value)).size !== field.options.length) {
			return `${name} lists the same option twice.`;
		}
		if (
			isMultiChoice(field) && field.maxSelections !== undefined &&
			field.maxSelections > field.options.length
		) {
			return `${name} allows more choices than it offers.`;
		}
	}
	if (field.kind === "number") {
		if (field.slider && (field.min === undefined || field.max === undefined)) {
			return `${name} needs a lowest and highest value for its slider.`;
		}
		if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
			return `${name}'s lowest value is above its highest.`;
		}
	}
	return null;
}

/**
 * Every question a buyer could not answer, in list order: an unwritten question, a choice with no
 * options or a blank or repeated one, a slider without both bounds, crossed bounds, a cap above the
 * options offered, or two questions sharing an id. Empty when the list saves.
 */
export function intakeProblems(fields: readonly IntakeField[]): IntakeProblem[] {
	const problems: IntakeProblem[] = [];
	const seen = new Set<string>();
	fields.forEach((field, i) => {
		if (seen.has(field.id)) {
			problems.push({ fieldId: field.id, message: `Two questions share the id ${field.id}.` });
		}
		seen.add(field.id);
		const message = fieldProblem(field, i + 1);
		if (message) problems.push({ fieldId: field.id, message });
	});
	if (problems.length === 0 && !IntakeFieldsSchema.safeParse(fields).success) {
		problems.push({ fieldId: fields[0]?.id ?? "", message: "These questions can't be saved." });
	}
	return problems;
}

/** Whether another question fits. */
export function canAddQuestion(fields: readonly IntakeField[]): boolean {
	return fields.length < INTAKE_FIELDS_MAX;
}
// #endregion

// #region Publish lock
export { intakeLockRefusal } from "@projective/types/services";

/**
 * Whether a listing's question ids are fixed: once it has been live, answers are stored under them
 * on every basket line and invitation, so a renamed or removed id would orphan them. It stays fixed
 * after a pause, an archive or a restore to draft, as `save_listing` holds it.
 */
export function intakeLocked(listing: Pick<ListingDetail, "publishedAt">): boolean {
	return hasBeenPublished(listing);
}
// #endregion
