import { assertEquals } from "@std/assert";
import {
	BindListingAvailabilitySchema,
	OccurrenceSpanSchema,
	SavePresetInputSchema,
	toOccurrenceSpans,
} from "./presets.ts";
import { SCHEDULE_TEMPLATES } from "./templates.ts";

/** The preset write payloads' invariants. */

Deno.test("a binding names a preset exactly when it is not the default", () => {
	const ok = (v: unknown) => BindListingAvailabilitySchema.safeParse(v).success;
	assertEquals(ok({ listingId: "svc-1", mode: "default", presetId: null }), true);
	assertEquals(ok({ listingId: "svc-1", mode: "preset", presetId: "p1" }), true);
	assertEquals(ok({ listingId: "svc-1", mode: "override", presetId: "p1" }), true);
	assertEquals(ok({ listingId: "svc-1", mode: "default", presetId: "p1" }), false);
	assertEquals(ok({ listingId: "svc-1", mode: "preset", presetId: null }), false);
});

Deno.test("a save takes a template's rules and refuses an inconsistent scope", () => {
	const [general] = SCHEDULE_TEMPLATES;
	const input = { name: general.name, timezone: general.timezone, rules: general.rules };
	const parsed = SavePresetInputSchema.parse(input);
	assertEquals([parsed.scope, parsed.blueprintId, parsed.isDefault], ["library", null, false]);
	assertEquals(SavePresetInputSchema.safeParse({ ...input, scope: "service" }).success, false);
	assertEquals(
		SavePresetInputSchema.safeParse({
			...input,
			scope: "service",
			blueprintId: "b1",
			isDefault: true,
		}).success,
		false,
	);
	assertEquals(
		SavePresetInputSchema.safeParse({ ...input, rules: [general.rules[0], general.rules[0]] })
			.success,
		false,
	);
	const refused = { ...general.rules[0], condition: { unlessWeekdays: [3] } };
	assertEquals(SavePresetInputSchema.safeParse({ ...input, rules: [refused] }).success, false);
});

Deno.test("occurrences serialise to ISO spans the door accepts", () => {
	const spans = toOccurrenceSpans([{
		kind: "call_window",
		startsAt: Date.parse("2026-10-12T09:00:00Z"),
		endsAt: Date.parse("2026-10-12T10:00:00Z"),
		ruleIds: ["r1"],
	}]);
	assertEquals(spans, [{
		kind: "call_window",
		startsAt: "2026-10-12T09:00:00.000Z",
		endsAt: "2026-10-12T10:00:00.000Z",
		ruleIds: ["r1"],
	}]);
	assertEquals(OccurrenceSpanSchema.safeParse(spans[0]).success, true);
	assertEquals(
		OccurrenceSpanSchema.safeParse({ ...spans[0], endsAt: spans[0].startsAt }).success,
		false,
	);
});
