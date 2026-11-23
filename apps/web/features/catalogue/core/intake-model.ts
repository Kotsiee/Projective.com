import { hasBeenPublished, type ListingDetail } from "@projective/types/catalogue";
import {
	conditionAnswers,
	conditionSources,
	INTAKE_FIELDS_MAX,
	intakeConditionRefusal,
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
	textarea: "Long answer",
	number: "Number",
	boolean: "Yes / No",
	radio: "Single choice",
	checkboxes: "Multiple choice",
	select: "Dropdown",
	multiselect: "Dropdown, several",
	pills: "Chips",
};

/**
 * The question types the builder's palette offers (Decision #525), in its order. The other kinds
 * stay reachable from a question's Answer type, so a listing that already uses one keeps it.
 */
export const PALETTE_KINDS: readonly IntakeFieldKind[] = [
	"text",
	"textarea",
	"number",
	"boolean",
	"radio",
	"checkboxes",
];

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
		const start = field.defaultValue;
		if (
			start !== undefined &&
			((field.min !== undefined && start < field.min) || (field.max !== undefined && start > field.max))
		) {
			return `${name}'s starting value is outside its lowest and highest.`;
		}
		if (field.pricing && field.pricing.perUnitMinor === 0) {
			return `${name} adjusts the guide price by nothing. Set a price per unit, or turn pricing off.`;
		}
	}
	return null;
}

/**
 * Every question a buyer could not answer, in list order: an unwritten question, a choice with no
 * options or a blank or repeated one, a slider without both bounds, crossed bounds, a starting value
 * outside them, pricing that moves nothing, a cap above the options offered, a follow-up that names no
 * earlier yes/no or choice question or an answer it no longer offers, or two questions sharing an id.
 * Empty when the list saves.
 */
export function intakeProblems(fields: readonly IntakeField[]): IntakeProblem[] {
	const problems: IntakeProblem[] = [];
	const seen = new Set<string>();
	fields.forEach((field, i) => {
		if (seen.has(field.id)) {
			problems.push({ fieldId: field.id, message: `Two questions share the id ${field.id}.` });
		}
		seen.add(field.id);
		const message = fieldProblem(field, i + 1) ?? intakeConditionRefusal(field, fields.slice(0, i));
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

// #region Branches (Decision #525)
/** One question as the builder draws it: where it sits, how deep, and the question it follows. */
export interface IntakeNode {
	field: IntakeField;
	/** Its position in the stored list. */
	index: number;
	/** 0 for a question asked to everyone, 1 for a follow-up to one of those, and so on. */
	depth: number;
	/** The question it follows, or `null`. */
	parentId: string | null;
}

/** The question a follow-up hangs under, when it is in the list; otherwise none. */
function parentOf(field: IntakeField, ids: ReadonlySet<string>): string | null {
	const source = field.condition?.fieldId;
	return source && source !== field.id && ids.has(source) ? source : null;
}

/**
 * The list as the builder draws it, in stored order: each question with its depth, a follow-up one
 * step under the question it follows. A follow-up whose question is gone is drawn as a question of
 * its own, where the problem check names it.
 */
export function intakeNodes(fields: readonly IntakeField[]): IntakeNode[] {
	const ids = new Set(fields.map((f) => f.id));
	const depth = new Map<string, number>();
	return fields.map((field, index) => {
		const parentId = parentOf(field, ids);
		const d = parentId === null ? 0 : (depth.get(parentId) ?? 0) + 1;
		depth.set(field.id, d);
		return { field, index, depth: d, parentId };
	});
}

/**
 * The list with every question followed directly by its follow-ups, depth-first, siblings in their
 * stored order: the order a buyer meets them, and the only one in which a branch can be drawn as a
 * branch. Each follow-up still comes after the question it follows, so a valid list stays valid.
 */
export function toBranchOrder(fields: readonly IntakeField[]): IntakeField[] {
	const ids = new Set(fields.map((f) => f.id));
	const children = new Map<string | null, IntakeField[]>();
	for (const field of fields) {
		const parent = parentOf(field, ids);
		children.set(parent, [...(children.get(parent) ?? []), field]);
	}
	const out: IntakeField[] = [];
	const seen = new Set<string>();
	const visit = (field: IntakeField) => {
		if (seen.has(field.id)) return;
		seen.add(field.id);
		out.push(field);
		for (const child of children.get(field.id) ?? []) visit(child);
	};
	for (const root of children.get(null) ?? []) visit(root);
	for (const field of fields) visit(field);
	return out;
}

/** The ids of question `id` and of every follow-up beneath it. */
export function branchIds(fields: readonly IntakeField[], id: string): Set<string> {
	const ids = new Set(fields.map((f) => f.id));
	const branch = new Set<string>([id]);
	for (const field of fields) {
		const parent = parentOf(field, ids);
		if (parent !== null && branch.has(parent)) branch.add(field.id);
	}
	return branch;
}

/** The list without question `id` and its follow-ups. */
export function removeBranch(fields: readonly IntakeField[], id: string): IntakeField[] {
	const gone = branchIds(fields, id);
	return fields.filter((f) => !gone.has(f.id));
}

/**
 * The list with question `id`'s branch moved to where sibling `targetId`'s branch is: before it when
 * moving up, after it when moving down. Only siblings trade places (two questions everyone is asked,
 * or two follow-ups of the same question), so no follow-up is ever moved above what it follows.
 */
export function moveBranch(
	fields: readonly IntakeField[],
	id: string,
	targetId: string,
): IntakeField[] {
	if (id === targetId) return [...fields];
	const ordered = toBranchOrder(fields);
	const ids = new Set(ordered.map((f) => f.id));
	const moving = ordered.find((f) => f.id === id);
	const target = ordered.find((f) => f.id === targetId);
	if (!moving || !target || parentOf(moving, ids) !== parentOf(target, ids)) return ordered;
	const block = branchIds(ordered, id);
	const rest = ordered.filter((f) => !block.has(f.id));
	const moved = ordered.filter((f) => block.has(f.id));
	const down = ordered.indexOf(moving) < ordered.indexOf(target);
	const targetBlock = branchIds(rest, targetId);
	const at = down
		? rest.findLastIndex((f) => targetBlock.has(f.id)) + 1
		: rest.findIndex((f) => f.id === targetId);
	return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/**
 * The list with `field` asked to everyone, placed before question `beforeId`'s branch (the root it
 * belongs to), or at the end when `beforeId` is `null` or gone.
 */
export function insertQuestion(
	fields: readonly IntakeField[],
	field: IntakeField,
	beforeId: string | null,
): IntakeField[] {
	const ordered = toBranchOrder(fields);
	const nodes = intakeNodes(ordered);
	const byId = new Map(nodes.map((n) => [n.field.id, n]));
	let root = beforeId === null ? undefined : byId.get(beforeId);
	while (root && root.parentId !== null) root = byId.get(root.parentId);
	const at = root ? ordered.findIndex((f) => f.id === root.field.id) : ordered.length;
	const fresh = { ...field, condition: undefined };
	return [...ordered.slice(0, at), fresh, ...ordered.slice(at)];
}

/**
 * The list with a new follow-up of `kind` under question `parentId`, after its existing follow-ups,
 * asked when the question is answered its first way (Yes, or its first option) until the seller
 * picks the answers it follows. `null` when the question cannot be followed or the list is full.
 */
export function addFollowUp(
	fields: readonly IntakeField[],
	parentId: string,
	kind: IntakeFieldKind,
): IntakeField[] | null {
	const parent = fields.find((f) => f.id === parentId);
	if (!parent || !canAddQuestion(fields) || conditionSources([parent]).length === 0) return null;
	const answers = conditionAnswers(parent);
	if (answers.length === 0) return null;
	const ordered = toBranchOrder(fields);
	const block = branchIds(ordered, parentId);
	const at = ordered.findLastIndex((f) => block.has(f.id)) + 1;
	const followUp: IntakeField = {
		...newIntakeField(kind, ordered),
		condition: { fieldId: parentId, anyOf: [answers[0].value], effect: "show" },
	};
	return [...ordered.slice(0, at), followUp, ...ordered.slice(at)];
}

/** Whether a question can carry follow-ups: a yes/no, or a choice with options to match on. */
export function canBeFollowed(field: IntakeField): boolean {
	return conditionSources([field]).length > 0 && conditionAnswers(field).length > 0;
}

/**
 * The list as one meta line's parts, for the Edit page's summary (`["4 questions", "2 required",
 * "1 follow-up"]`); empty when there are none.
 */
export function intakeSummary(fields: readonly IntakeField[]): string[] {
	if (fields.length === 0) return [];
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const parts = [plural(fields.length, "question", "questions")];
	const required = fields.filter((f) => f.required).length;
	if (required > 0) parts.push(`${required} required`);
	const followUps = intakeNodes(fields).filter((n) => n.parentId !== null).length;
	if (followUps > 0) parts.push(plural(followUps, "follow-up", "follow-ups"));
	return parts;
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
