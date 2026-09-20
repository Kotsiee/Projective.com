import { assertEquals } from "@std/assert";
import {
	emptyIntakeAnswers,
	intakeAnswerLines,
	IntakeFieldSchema,
	intakeRefusal,
	normaliseIntakeAnswers,
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
