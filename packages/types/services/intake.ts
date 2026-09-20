import { z } from "zod";

/**
 * services.intake — the **seller-defined requirements** a buyer answers before hiring: the field
 * vocabulary, the answer shape, and the ONE validation rule both ends of the wire call.
 *
 * A seller may ask a buyer for things the platform cannot know in advance — a word count, a target
 * platform, whether brand guidelines exist, which of three tiers they want. Those questions are DATA
 * the seller authored (on a listing, or on their profile for a project assignment), so the modal that
 * asks them is a RENDERER over this schema rather than a form somebody wrote by hand: the same field
 * list drives the controls, the client-side gate, the server-side refusal and the plain-text brief
 * the answers are folded into.
 *
 * # Why one rule, called twice
 *
 * {@link intakeRefusal} is called by the modal to gate its primary control and explain a refusal in
 * place, and again by the fat service on the way in. A form that lets something through is therefore
 * never a form that gets it accepted for a rule it did not know — and a seller who marks a field
 * required is guaranteed an answer whether or not the buyer's client honoured the mark.
 *
 * # Why the answers are a record, not an array
 *
 * Keyed by the field's own id so a payload survives the seller reordering their questions, and so an
 * answer to a field the seller has since removed is DROPPED ({@link normaliseIntakeAnswers}) rather
 * than failing the purchase: a stale form is the buyer's client being a page behind, not a refusal.
 *
 * Pure and client-safe: no DOM, no clock, no money math. A leaf module — it imports nothing but Zod
 * — so the explore, profile and services domains can all reach it without a cycle.
 */

// #region Vocabulary
/**
 * The nine control kinds a seller may ask with.
 *
 * Each maps onto exactly one `@projective/ui/fields` control in the renderer; the split keeps a
 * `select` (one of many, in a dropdown) apart from a `radio` (one of few, all visible) and `pills`
 * (one or many, as chips) because they are different affordances for different option counts, and a
 * renderer that collapsed them would pick wrong for one of the three.
 */
export const IntakeFieldKind = z.enum([
	/** One line of text. */
	"text",
	/** A paragraph. */
	"textarea",
	/** A number, optionally with a slider when it has both bounds. */
	"number",
	/** A yes/no toggle. */
	"boolean",
	/** Exactly one option, from a dropdown. */
	"select",
	/** Any number of options, from a dropdown. */
	"multiselect",
	/** Exactly one option, all visible. */
	"radio",
	/** One or many options as chips — `multiple` decides which. */
	"pills",
	/** Any number of options, each a checkbox. */
	"checkboxes",
]);
export type IntakeFieldKind = z.infer<typeof IntakeFieldKind>;

/** The kinds whose answer is one of the field's options. */
export const SINGLE_CHOICE_KINDS: readonly IntakeFieldKind[] = ["select", "radio"];

/** The kinds whose answer is a list drawn from the field's options. */
export const MULTI_CHOICE_KINDS: readonly IntakeFieldKind[] = ["multiselect", "checkboxes"];

/** How many fields a seller may ask — a brief, not an application form. */
export const INTAKE_FIELDS_MAX = 12;

/** The ceiling on a free-text answer. */
export const INTAKE_TEXT_MAX = 2000;

/** One option a choice field offers. */
export const IntakeOptionSchema = z.object({
	value: z.string().min(1).max(80),
	label: z.string().min(1).max(120),
	/** A one-line gloss under the label, for a choice that needs explaining. */
	hint: z.string().max(160).optional(),
});
export type IntakeOption = z.infer<typeof IntakeOptionSchema>;

/**
 * One question the seller asks.
 *
 * `min` / `max` / `step` / `unit` / `slider` apply to a `number`; `options` and `multiple` to the
 * choice kinds; `maxLength` and `placeholder` to the text kinds. A field may carry facets its kind
 * ignores — the renderer reads only what its control understands — so a seller switching a field's
 * kind does not have to scrub the others first.
 */
export const IntakeFieldSchema = z.object({
	/** Stable within the seller's field list — the key an answer is stored under. */
	id: z.string().min(1).max(60),
	kind: IntakeFieldKind,
	label: z.string().min(1).max(120),
	/** The one-line explanation under the label. */
	hint: z.string().max(240).optional(),
	required: z.boolean().default(false),
	placeholder: z.string().max(120).optional(),
	/** The choices, for a choice kind. Empty for every other kind. */
	options: z.array(IntakeOptionSchema).max(24).default([]),
	/** `pills` only — whether more than one chip may be chosen. */
	multiple: z.boolean().default(false),
	/** A multi-choice cap. Absent means any number. */
	maxSelections: z.number().int().min(1).max(24).optional(),
	/** Numeric bounds. A slider is offered only when BOTH are present. */
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().positive().optional(),
	/** The unit a number is in (`words`, `pages`, `%`) — printed beside the control. */
	unit: z.string().max(24).optional(),
	/** Whether a bounded number ALSO offers a slider. */
	slider: z.boolean().default(false),
	/** A text ceiling below {@link INTAKE_TEXT_MAX}. */
	maxLength: z.number().int().min(1).max(INTAKE_TEXT_MAX).optional(),
});
export type IntakeField = z.infer<typeof IntakeFieldSchema>;

/** The seller's whole list. */
export const IntakeFieldsSchema = z.array(IntakeFieldSchema).max(INTAKE_FIELDS_MAX);
// #endregion

// #region Answers
/**
 * One answer. `null` is "unanswered" — distinct from `""`, `false` and `[]`, which are answers a
 * buyer gave (an empty optional text, a declined toggle, no chips chosen).
 */
export const IntakeAnswerSchema = z.union([
	z.string().max(INTAKE_TEXT_MAX),
	z.number(),
	z.boolean(),
	z.array(z.string().max(80)).max(24),
	z.null(),
]);
export type IntakeAnswer = z.infer<typeof IntakeAnswerSchema>;

/** Every answer, keyed by field id. */
export const IntakeAnswersSchema = z.record(z.string().max(60), IntakeAnswerSchema);
export type IntakeAnswers = z.infer<typeof IntakeAnswersSchema>;

/**
 * The resting answers for a field list — what a fresh form starts from.
 *
 * A toggle starts `false` (an unanswered yes/no is a no), a multi-choice starts empty, and everything
 * else starts `null`. A `number` deliberately does NOT start at its minimum: a bound is a constraint
 * on an answer, not an answer, and seeding it would satisfy a required field with a figure nobody
 * typed.
 */
export function emptyIntakeAnswers(fields: readonly IntakeField[]): IntakeAnswers {
	const answers: IntakeAnswers = {};
	for (const field of fields) {
		if (field.kind === "boolean") answers[field.id] = false;
		else if (isMultiChoice(field)) answers[field.id] = [];
		else answers[field.id] = null;
	}
	return answers;
}

/** Whether a field's answer is a list of option values. */
export function isMultiChoice(field: Pick<IntakeField, "kind" | "multiple">): boolean {
	return MULTI_CHOICE_KINDS.includes(field.kind) || (field.kind === "pills" && field.multiple);
}

/** Whether a field's answer is exactly one option value. */
export function isSingleChoice(field: Pick<IntakeField, "kind" | "multiple">): boolean {
	return SINGLE_CHOICE_KINDS.includes(field.kind) || (field.kind === "pills" && !field.multiple);
}

/**
 * Drop answers to fields that no longer exist.
 *
 * Called on the way IN by the fat service: a buyer whose page is one edit behind the seller's field
 * list is not attempting anything, and a purchase refused for "unknown field" would be a refusal the
 * buyer cannot act on. Unknown keys are the only thing removed — nothing is coerced.
 */
export function normaliseIntakeAnswers(
	fields: readonly IntakeField[],
	answers: IntakeAnswers,
): IntakeAnswers {
	const known = new Set(fields.map((f) => f.id));
	const kept: IntakeAnswers = {};
	for (const [id, answer] of Object.entries(answers)) {
		if (known.has(id)) kept[id] = answer;
	}
	return kept;
}
// #endregion

// #region The rule
/**
 * Why a set of answers cannot be accepted, or `null`.
 *
 * Field-keyed so a form can pin the sentence to the control that refused it. The FIRST refusal is
 * returned rather than every one: a buyer fixes them one at a time in document order, and a modal
 * that lit up seven controls at once has told them nothing about where to start.
 */
export const IntakeRefusalCode = z.enum([
	"required",
	"too_long",
	"not_a_number",
	"below_min",
	"above_max",
	"unknown_option",
	"too_many",
	"wrong_shape",
]);
export type IntakeRefusalCode = z.infer<typeof IntakeRefusalCode>;

export interface IntakeRefusal {
	/** The field that refused. */
	fieldId: string;
	code: IntakeRefusalCode;
	/** The sentence the surface shows beside the control. */
	message: string;
}

/**
 * Whether an answer counts as GIVEN for a required check.
 *
 * "Given" means the buyer supplied something — a non-empty string, a non-empty list, a finite number,
 * or a yes/no either way. It is deliberately NOT a shape check: a string in a number field is an
 * attempt at an answer and is refused as `not_a_number` by {@link intakeRefusal}, where treating it
 * as "unanswered" would tell a buyer who typed "lots" that the field is empty.
 *
 * A toggle is always answered — `false` is the answer "no". A seller who needs a yes asks for it in
 * the label; the platform does not decide that "no" is a missing answer.
 */
export function intakeAnswered(_field: IntakeField, answer: IntakeAnswer | undefined): boolean {
	if (answer === undefined || answer === null) return false;
	if (typeof answer === "string") return answer.trim().length > 0;
	if (Array.isArray(answer)) return answer.length > 0;
	if (typeof answer === "number") return Number.isFinite(answer);
	return true;
}

export function intakeRefusal(
	fields: readonly IntakeField[],
	answers: IntakeAnswers,
): IntakeRefusal | null {
	for (const field of fields) {
		const answer = answers[field.id];
		const given = intakeAnswered(field, answer);

		if (!given) {
			if (field.required) {
				return { fieldId: field.id, code: "required", message: `${field.label} is required.` };
			}
			continue;
		}

		switch (field.kind) {
			case "text":
			case "textarea": {
				const cap = Math.min(field.maxLength ?? INTAKE_TEXT_MAX, INTAKE_TEXT_MAX);
				if (typeof answer !== "string") {
					return wrongShape(field);
				}
				if (answer.length > cap) {
					return {
						fieldId: field.id,
						code: "too_long",
						message: `${field.label} is over ${cap} characters.`,
					};
				}
				break;
			}
			case "number": {
				if (typeof answer !== "number" || !Number.isFinite(answer)) {
					return {
						fieldId: field.id,
						code: "not_a_number",
						message: `${field.label} needs a number.`,
					};
				}
				if (field.min !== undefined && answer < field.min) {
					return {
						fieldId: field.id,
						code: "below_min",
						message: `${field.label} must be at least ${field.min}${unitSuffix(field)}.`,
					};
				}
				if (field.max !== undefined && answer > field.max) {
					return {
						fieldId: field.id,
						code: "above_max",
						message: `${field.label} must be at most ${field.max}${unitSuffix(field)}.`,
					};
				}
				break;
			}
			case "boolean":
				if (typeof answer !== "boolean") return wrongShape(field);
				break;
			default: {
				const allowed = new Set(field.options.map((o) => o.value));
				if (isMultiChoice(field)) {
					if (!Array.isArray(answer)) return wrongShape(field);
					for (const value of answer) {
						if (!allowed.has(value)) {
							return {
								fieldId: field.id,
								code: "unknown_option",
								message: `${field.label} has a choice that is no longer offered.`,
							};
						}
					}
					if (field.maxSelections !== undefined && answer.length > field.maxSelections) {
						return {
							fieldId: field.id,
							code: "too_many",
							message: `${field.label} takes up to ${field.maxSelections}.`,
						};
					}
				} else {
					if (typeof answer !== "string") return wrongShape(field);
					if (!allowed.has(answer)) {
						return {
							fieldId: field.id,
							code: "unknown_option",
							message: `${field.label} has a choice that is no longer offered.`,
						};
					}
				}
			}
		}
	}
	return null;
}

function wrongShape(field: IntakeField): IntakeRefusal {
	return { fieldId: field.id, code: "wrong_shape", message: `${field.label} could not be read.` };
}

function unitSuffix(field: IntakeField): string {
	return field.unit ? ` ${field.unit}` : "";
}
// #endregion

// #region Rendering the answers as prose
/**
 * The answers as `Label: value` lines — what a brief, an invitation message or a basket line's
 * metadata carries so the seller reads the buyer's answers wherever the engagement is opened.
 *
 * Unanswered optional fields are OMITTED rather than printed as "—": a seller reads the brief for what
 * the buyer said, and eleven blank rows bury the four that matter. A choice value is printed by its
 * LABEL, because the value is the seller's own key and means nothing to anybody reading the thread.
 */
export function intakeAnswerLines(
	fields: readonly IntakeField[],
	answers: IntakeAnswers,
): string[] {
	const lines: string[] = [];
	for (const field of fields) {
		const answer = answers[field.id];
		if (!intakeAnswered(field, answer)) continue;
		lines.push(`${field.label}: ${intakeAnswerText(field, answer as IntakeAnswer)}`);
	}
	return lines;
}

/** One answer as the words a reader would use for it. */
export function intakeAnswerText(field: IntakeField, answer: IntakeAnswer): string {
	if (answer === null) return "";
	if (typeof answer === "boolean") return answer ? "Yes" : "No";
	if (typeof answer === "number") return `${answer}${unitSuffix(field)}`;
	const labelOf = (value: string) => field.options.find((o) => o.value === value)?.label ?? value;
	if (Array.isArray(answer)) return answer.map(labelOf).join(", ");
	if (field.kind === "text" || field.kind === "textarea") return answer.trim();
	return labelOf(answer);
}
// #endregion
