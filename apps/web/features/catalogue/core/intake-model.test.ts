import { assert, assertEquals } from "@std/assert";
import { type IntakeField, IntakeFieldsSchema, intakeRefusal } from "@projective/types/services";
import {
	intakeLocked,
	intakeLockRefusal,
	intakeProblems,
	newIntakeField,
	nextFieldId,
	optionValue,
	withKind,
	withOptionAdded,
	withOptionLabel,
	withOptionRemoved,
} from "./intake-model.ts";

function question(id: string, patch: Partial<IntakeField> = {}): IntakeField {
	return {
		id,
		kind: "text",
		label: `Question ${id}`,
		required: false,
		options: [],
		multiple: false,
		slider: false,
		...patch,
	};
}

Deno.test("ids are generated, unique within the list, and never reuse a taken one", () => {
	assertEquals(nextFieldId([]), "q1");
	assertEquals(nextFieldId([{ id: "q2" }]), "q3");
	assertEquals(nextFieldId([{ id: "q1" }, { id: "q3" }]), "q4");
	assertEquals(nextFieldId([{ id: "brief" }]), "q2");
});

Deno.test("option values derive from labels and stay unique", () => {
	assertEquals(optionValue("Brand guidelines", []), "brand-guidelines");
	assertEquals(
		optionValue("Brand guidelines", [{ value: "brand-guidelines" }]),
		"brand-guidelines-2",
	);
	assertEquals(optionValue("!!!", []), "option");
});

Deno.test("a fresh choice question is answerable as it stands", () => {
	const field = { ...newIntakeField("radio", []), label: "Tier" };
	assertEquals(field.options.length, 1);
	assertEquals(intakeProblems([field]), []);
	assert(IntakeFieldsSchema.safeParse([field]).success);
	assertEquals(intakeRefusal([field], { [field.id]: field.options[0].value }), null);
});

Deno.test("switching kind keeps facets and gives a choice kind an option", () => {
	const text = question("q1", { placeholder: "e.g. 500" });
	const select = withKind(text, "select");
	assertEquals(select.options.length, 1);
	assertEquals(select.placeholder, "e.g. 500");
	assertEquals(withKind(select, "text").options, select.options);
});

Deno.test("option edits keep values stable", () => {
	let field = withKind(question("q1"), "checkboxes");
	field = withOptionAdded(field, "Logo");
	field = withOptionAdded(field, "Logo");
	assertEquals(field.options.map((o) => o.value), ["option-1", "logo", "logo-2"]);
	field = withOptionLabel(field, 1, "Wordmark");
	assertEquals(field.options[1], { value: "logo", label: "Wordmark" });
	assertEquals(withOptionRemoved(field, 0).options.length, 2);
});

Deno.test("intakeProblems is the seller-side inverse of intakeRefusal", () => {
	assertEquals(intakeProblems([question("q1", { label: " " })])[0].message, "Write question 1.");
	assertEquals(
		intakeProblems([question("q1", { kind: "select", options: [] })])[0].message,
		'"Question q1" needs at least one option.',
	);
	assertEquals(
		intakeProblems([question("q1", { kind: "number", slider: true, min: 0 })])[0].message,
		'"Question q1" needs a lowest and highest value for its slider.',
	);
	assertEquals(
		intakeProblems([question("q1", { kind: "number", min: 10, max: 2 })])[0].message,
		'"Question q1"\'s lowest value is above its highest.',
	);
	assertEquals(
		intakeProblems([question("q1"), question("q1")])[0].message,
		"Two questions share the id q1.",
	);
	assertEquals(
		intakeProblems([
			question("q1", {
				kind: "checkboxes",
				options: [{ value: "a", label: "A" }],
				maxSelections: 3,
			}),
		])[0].message,
		'"Question q1" allows more choices than it offers.',
	);
	assertEquals(intakeProblems([question("q1"), question("q2", { kind: "boolean" })]), []);
});

Deno.test("the publish lock allows wording and option edits only", () => {
	const before = [
		question("q1"),
		question("q2", { kind: "radio", options: [{ value: "a", label: "A" }] }),
	];
	assert(intakeLocked({ publishedAt: "2026-10-01T09:00:00Z" }));
	assert(!intakeLocked({ publishedAt: null }));

	const reworded = [
		{ ...before[0], label: "What's the deadline?", hint: "A date is fine" },
		withOptionAdded(withOptionLabel(before[1], 0, "Option A"), "B"),
	];
	assertEquals(intakeLockRefusal(before, reworded), null);

	assertEquals(
		intakeLockRefusal(before, [before[1], before[0]]),
		"Questions can't be added, removed or reordered once the listing has been published.",
	);
	assertEquals(
		intakeLockRefusal(before, [...before, question("q3")]),
		"Questions can't be added, removed or reordered once the listing has been published.",
	);
	assertEquals(
		intakeLockRefusal(before, [withKind(before[0], "textarea"), before[1]]),
		"Only a question's wording and options can change once the listing has been published.",
	);
	assertEquals(
		intakeLockRefusal(before, [{ ...before[0], required: true }, before[1]]),
		"Only a question's wording and options can change once the listing has been published.",
	);
});

Deno.test("the publish lock ignores the key order jsonb stores a question in", () => {
	const stored = [question("q1", { hint: "A date is fine" })];
	const reordered = stored.map((f) =>
		Object.fromEntries(Object.entries(f).reverse()) as unknown as IntakeField
	);
	assertEquals(intakeLockRefusal(stored, reordered), null);
	assertEquals(intakeLockRefusal(stored, [{ ...reordered[0], hint: undefined }]), null);
	assertEquals(
		intakeLockRefusal(stored, [{ ...reordered[0], id: "q9" }]),
		"Questions can't be added, removed or reordered once the listing has been published.",
	);
});
