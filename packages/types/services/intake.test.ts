import { assertEquals } from "@std/assert";
import {
	emptyIntakeAnswers,
	intakeAnswerLines,
	IntakeFieldSchema,
	IntakeFieldsSchema,
	intakeListRefusal,
	intakeLockRefusal,
	intakePriceAdjustment,
	intakeRefusal,
	normaliseIntakeAnswers,
	visibleIntakeIds,
} from "./intake.ts";

/**
 * The intake rule, pinned.
 *
 * Every assertion is a claim the split modal makes to a buyer — "this field is required", "that
 * choice is no longer offered" — and the failure mode of an unchecked rule here is a purchase
 * accepted with an answer the seller never asked for, or refused for one the buyer gave. Both are
 * invisible to a source-reading review, because the modal renders either way.
 */

const fields = [
	IntakeFieldSchema.parse({
		id: "words",
		kind: "number",
		label: "Word count",
		min: 100,
		max: 5000,
		unit: "words",
		required: true,
	}),
	IntakeFieldSchema.parse({ id: "brand", kind: "boolean", label: "Brand guidelines exist" }),
	IntakeFieldSchema.parse({
		id: "tier",
		kind: "radio",
		label: "Tier",
		required: true,
		options: [{ value: "lite", label: "Lite" }, { value: "full", label: "Full" }],
	}),
	IntakeFieldSchema.parse({
		id: "channels",
		kind: "checkboxes",
		label: "Channels",
		maxSelections: 2,
		options: [{ value: "web", label: "Web" }, { value: "print", label: "Print" }, {
			value: "social",
			label: "Social",
		}],
	}),
	IntakeFieldSchema.parse({ id: "notes", kind: "textarea", label: "Notes", maxLength: 20 }),
];

Deno.test("emptyIntakeAnswers: a toggle starts false, a multi-choice empty, everything else null", () => {
	assertEquals(emptyIntakeAnswers(fields), {
		words: null,
		brand: false,
		tier: null,
		channels: [],
		notes: null,
	});
});

Deno.test("intakeRefusal: the first required field without an answer refuses, in document order", () => {
	const refusal = intakeRefusal(fields, { ...emptyIntakeAnswers(fields), tier: "lite" });
	assertEquals(refusal?.fieldId, "words");
	assertEquals(refusal?.code, "required");
	// A declined toggle is an answer, never a missing one.
	assertEquals(
		intakeRefusal(fields, { words: 500, brand: false, tier: "full", channels: [], notes: null }),
		null,
	);
});

Deno.test("intakeRefusal: a number is held to its bounds", () => {
	const base = { brand: false, tier: "lite", channels: [], notes: null };
	assertEquals(intakeRefusal(fields, { ...base, words: 50 })?.code, "below_min");
	assertEquals(intakeRefusal(fields, { ...base, words: 9000 })?.code, "above_max");
	assertEquals(intakeRefusal(fields, { ...base, words: "lots" })?.code, "not_a_number");
});

Deno.test("intakeRefusal: a choice must be one the seller offers, and a cap is a cap", () => {
	const base = { words: 500, brand: true, notes: null };
	assertEquals(
		intakeRefusal(fields, { ...base, tier: "gold", channels: [] })?.code,
		"unknown_option",
	);
	assertEquals(
		intakeRefusal(fields, { ...base, tier: "lite", channels: ["web", "print", "social"] })?.code,
		"too_many",
	);
	assertEquals(
		intakeRefusal(fields, { ...base, tier: "lite", channels: ["web", "tv"] })?.code,
		"unknown_option",
	);
	assertEquals(intakeRefusal(fields, { ...base, tier: "lite", channels: ["web", "print"] }), null);
});

Deno.test("intakeRefusal: text is held to its ceiling, and an optional blank is fine", () => {
	const base = { words: 500, brand: true, tier: "lite", channels: [] };
	assertEquals(intakeRefusal(fields, { ...base, notes: "x".repeat(21) })?.code, "too_long");
	assertEquals(intakeRefusal(fields, { ...base, notes: "   " }), null);
});

Deno.test("normaliseIntakeAnswers: an answer to a field the seller removed is dropped, not refused", () => {
	const kept = normaliseIntakeAnswers(fields, { words: 500, gone: "stale", brand: true });
	assertEquals(Object.keys(kept), ["words", "brand"]);
});

Deno.test("intakeAnswerLines: answered fields only, choices by their label, numbers with their unit", () => {
	assertEquals(
		intakeAnswerLines(fields, {
			words: 1200,
			brand: true,
			tier: "full",
			channels: ["web", "social"],
			notes: null,
		}),
		[
			"Word count: 1200 words",
			"Brand guidelines exist: Yes",
			"Tier: Full",
			"Channels: Web, Social",
		],
	);
});

Deno.test("follow-ups — a question shows only while the answer it follows matches", () => {
	const fields = IntakeFieldsSchema.parse([
		{ id: "brand", kind: "boolean", label: "Do you have brand guidelines?" },
		{
			id: "files",
			kind: "text",
			label: "Link to them",
			required: true,
			condition: { fieldId: "brand", anyOf: [true] },
		},
		{
			id: "style",
			kind: "radio",
			label: "Preferred style",
			options: [{ value: "bold", label: "Bold" }, { value: "calm", label: "Calm" }],
			condition: { fieldId: "brand", anyOf: [true], effect: "hide" },
		},
		{
			id: "why",
			kind: "text",
			label: "Why bold?",
			required: true,
			condition: { fieldId: "style", anyOf: ["bold"] },
		},
	]);
	const no = { brand: false, files: null, style: "bold", why: null };
	assertEquals([...visibleIntakeIds(fields, no)], ["brand", "style", "why"]);
	assertEquals(intakeRefusal(fields, no)?.fieldId, "why");
	const yes = { brand: true, files: null, style: "bold", why: null };
	assertEquals([...visibleIntakeIds(fields, yes)], ["brand", "files"]);
	assertEquals(intakeRefusal(fields, yes)?.fieldId, "files");
	assertEquals(normaliseIntakeAnswers(fields, { ...yes, files: "https://x.test" }), {
		brand: true,
		files: "https://x.test",
	});
	assertEquals(intakeAnswerLines(fields, { ...yes, files: "https://x.test" }), [
		"Do you have brand guidelines?: Yes",
		"Link to them: https://x.test",
	]);
});

Deno.test("intakeListRefusal — a follow-up names an earlier yes/no or choice, and answers it offers", () => {
	const base = { id: "a", kind: "boolean", label: "A" } as const;
	assertEquals(intakeListRefusal(IntakeFieldsSchema.parse([base])), null);
	assertEquals(
		typeof intakeListRefusal(IntakeFieldsSchema.parse([
			{ id: "b", kind: "text", label: "B", condition: { fieldId: "a", anyOf: [true] } },
			base,
		])),
		"string",
	);
	assertEquals(
		typeof intakeListRefusal(IntakeFieldsSchema.parse([
			{ id: "t", kind: "text", label: "T" },
			{ id: "b", kind: "text", label: "B", condition: { fieldId: "t", anyOf: ["x"] } },
		])),
		"string",
	);
	assertEquals(
		typeof intakeListRefusal(IntakeFieldsSchema.parse([
			{ id: "c", kind: "select", label: "C", options: [{ value: "x", label: "X" }] },
			{ id: "b", kind: "text", label: "B", condition: { fieldId: "c", anyOf: ["gone"] } },
		])),
		"string",
	);
});

Deno.test("the guide price — linear per unit past the included amount, from the starting value when unanswered", () => {
	const fields = IntakeFieldsSchema.parse([
		{
			id: "pages",
			kind: "number",
			label: "Screens or pages",
			min: 1,
			max: 20,
			defaultValue: 5,
			pricing: { model: "linear", perUnitMinor: 4000, includedUnits: 3 },
		},
		{ id: "note", kind: "text", label: "Anything else" },
	]);
	assertEquals(emptyIntakeAnswers(fields).pages, 5);
	assertEquals(intakePriceAdjustment(fields, { pages: 8 }), 20000);
	assertEquals(intakePriceAdjustment(fields, { pages: 2 }), 0);
	assertEquals(intakePriceAdjustment(fields, {}), 8000);
	assertEquals(intakePriceAdjustment(IntakeFieldsSchema.parse([{ id: "n", kind: "number", label: "N" }]), { n: 3 }), null);
});

Deno.test("the publish lock — a starting value and pricing may change, a follow-up rule may not", () => {
	const before = IntakeFieldsSchema.parse([
		{ id: "a", kind: "boolean", label: "A" },
		{ id: "n", kind: "number", label: "N", defaultValue: 2 },
	]);
	const repriced = IntakeFieldsSchema.parse([
		{ id: "a", kind: "boolean", label: "A" },
		{ id: "n", kind: "number", label: "N", defaultValue: 4, pricing: { model: "linear", perUnitMinor: 100 } },
	]);
	assertEquals(intakeLockRefusal(before, repriced), null);
	const followed = IntakeFieldsSchema.parse([
		{ id: "a", kind: "boolean", label: "A" },
		{ id: "n", kind: "number", label: "N", defaultValue: 2, condition: { fieldId: "a", anyOf: [true] } },
	]);
	assertEquals(typeof intakeLockRefusal(before, followed), "string");
});
