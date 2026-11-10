/**
 * The cross-check for one-layer availability, rule pricing and swatches (Decision #408): the SQL's
 * columns and checks against the Zod that mirrors them, the doors that refuse a call window, the gate
 * that books a call inside working hours, and the definer that prices one.
 *
 * Over FILE CONTENT (the `presets.contract.test.ts` technique), so it fails with no database the moment
 * one side is edited without the other.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { AvailabilityRuleDraftSchema, RuleFeeSchema } from "./recurrence.ts";
import {
	AvailabilityRuleRowSchema,
	CssTokenName,
	RecurrenceRuleRowSchema,
	SchedulingEventRowSchema,
} from "./rows.ts";
import { EntryFieldsSchema } from "./scheduling.ts";
import { OccurrenceSpanSchema } from "./presets.ts";
import { SaveOwnerAvailabilitySchema } from "./owner-availability.ts";
import { SWATCH_COLOR_TOKENS, swatchAccent } from "./swatches.ts";

const REPO = new URL("../../../", import.meta.url);
/** File text with whitespace collapsed, so an assertion never depends on line endings or wrapping. */
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\s+/g, " ");

const TABLES_SQL = "supabase/migrations/00000022_tables_scheduling.sql";
const FUNCTIONS_SQL = "supabase/migrations/00001510_functions_scheduling.sql";
const GRANTS_SQL = "supabase/migrations/00002510_permissions_function_grants.sql";

/** The body of one `CREATE OR REPLACE FUNCTION`, from its name to the next one. */
function fn(sql: string, name: string): string {
	const at = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
	assert(at >= 0, `${name} is not defined`);
	const next = sql.indexOf("CREATE OR REPLACE FUNCTION", at + 10);
	return sql.slice(at, next < 0 ? undefined : next);
}

const draft = (over: Record<string, unknown> = {}) => ({
	id: "rule-1",
	effect: "add",
	pattern: { type: "weekly", days: [1], interval: 1 },
	bands: [{ start: 540, end: 1020 }],
	startsOn: "2026-01-05",
	endsOn: null,
	...over,
});

Deno.test("a price is positive minor units with an upper-case currency, both or neither, on both sides", () => {
	const sql = read(TABLES_SQL);
	for (const table of ["availability_rule", "recurrence_rule"]) {
		assertStringIncludes(
			sql,
			`CONSTRAINT ck_${table}_fee CHECK ((fee_amount_minor IS NULL) = (fee_currency IS NULL))`,
		);
	}
	assertEquals(sql.split("fee_amount_minor bigint CHECK (fee_amount_minor > 0)").length - 1, 2);
	assertEquals(sql.split("fee_currency char(3) CHECK (fee_currency ~ '^[A-Z]{3}$')").length - 1, 2);

	assert(RuleFeeSchema.safeParse({ amountMinor: 6000, currency: "GBP" }).success);
	for (const bad of [{ amountMinor: 0, currency: "GBP" }, { amountMinor: 1.5, currency: "GBP" }]) {
		assertFalse(RuleFeeSchema.safeParse(bad).success, JSON.stringify(bad));
	}
	assertFalse(RuleFeeSchema.safeParse({ amountMinor: 100, currency: "gbp" }).success);
	assert("feeAmountMinor" in RecurrenceRuleRowSchema.shape);
	assert("colorToken" in RecurrenceRuleRowSchema.shape);
	assert("feeAmountMinor" in AvailabilityRuleRowSchema.shape);
});

Deno.test("a rule that removes hours has no price; one that adds them may", () => {
	assertStringIncludes(
		read(TABLES_SQL),
		"CONSTRAINT ck_recurrence_rule_subtract_fee CHECK (effect <> 'subtract' OR fee_amount_minor IS NULL)",
	);
	assertStringIncludes(
		fn(read(FUNCTIONS_SQL), "scheduling.save_availability_preset"),
		"IF v_rule ->> 'effect' = 'subtract' AND NULLIF(v_rule ->> 'fee_amount_minor', '') IS NOT NULL THEN",
	);
	assert(
		AvailabilityRuleDraftSchema.safeParse(draft({ fee: { amountMinor: 6000, currency: "GBP" } }))
			.success,
	);
	assertFalse(
		AvailabilityRuleDraftSchema.safeParse(
			draft({ effect: "subtract", bands: [], fee: { amountMinor: 6000, currency: "GBP" } }),
		).success,
	);
	assert(AvailabilityRuleDraftSchema.safeParse(draft({ effect: "subtract", bands: [] })).success);
});

Deno.test("a colour is a token name, and a written one is a swatch", () => {
	const sql = read(TABLES_SQL);
	assertStringIncludes(sql, "color_token text CHECK (color_token ~ '^--[a-z][a-z0-9-]{0,58}$')");
	assertStringIncludes(
		sql,
		"CONSTRAINT ck_event_accent CHECK (accent ~ '^--[a-z][a-z0-9-]{0,58}$')",
	);
	assertEquals(CssTokenName.safeParse("--x;background:url(x)").success, false);

	for (const token of SWATCH_COLOR_TOKENS) {
		const stored = swatchAccent(token);
		if (stored === null) continue;
		assert(CssTokenName.safeParse(stored).success, stored);
		assert(AvailabilityRuleDraftSchema.safeParse(draft({ colorToken: stored })).success, stored);
	}
	assertFalse(AvailabilityRuleDraftSchema.safeParse(draft({ colorToken: "--primary" })).success);
	assert(EntryFieldsSchema.shape.accent.safeParse("--swatch-teal").success);
	assert(EntryFieldsSchema.shape.accent.safeParse(null).success);
	assertFalse(EntryFieldsSchema.shape.accent.safeParse("--danger").success);
	assertFalse(SchedulingEventRowSchema.shape.accent.safeParse("#ff0000").success);
	assert(SchedulingEventRowSchema.shape.accent.safeParse("--swatch-teal").success);
});

Deno.test("one layer: every door writes working hours and refuses a call window", () => {
	const sql = read(FUNCTIONS_SQL);
	const owner = fn(sql, "scheduling.save_owner_availability");
	assertStringIncludes(owner, "COALESCE(v_rule ->> 'kind', 'working_hours') <> 'working_hours'");
	assertStringIncludes(owner, "'working_hours'::scheduling.availability_kind,");
	assertStringIncludes(owner, "fee_amount_minor, fee_currency");

	const preset = fn(sql, "scheduling.save_availability_preset");
	assertStringIncludes(preset, "COALESCE(v_rule ->> 'kind', 'working_hours') <> 'working_hours'");
	assertStringIncludes(preset, "is_active, position, fee_amount_minor, fee_currency, color_token");

	assertStringIncludes(
		fn(sql, "scheduling.replace_preset_occurrences"),
		"COALESCE(e ->> 'kind', '') <> 'working_hours'",
	);
	assertFalse(
		OccurrenceSpanSchema.safeParse({
			kind: "call_window",
			startsAt: "2026-10-12T09:00:00Z",
			endsAt: "2026-10-12T10:00:00Z",
			ruleIds: [],
		}).success,
	);
	assertFalse("bands" in SaveOwnerAvailabilitySchema.shape);
});

Deno.test("a call is booked inside working hours, and touching bands read as one span", () => {
	const sql = read(FUNCTIONS_SQL);
	assertStringIncludes(
		fn(sql, "scheduling.fn_call_window_covers"),
		"scheduling.fn_band_covers (p_schedule, 'working_hours'::scheduling.availability_kind, p_starts_at, p_ends_at)",
	);
	const covers = fn(sql, "scheduling.fn_band_covers");
	assertStringIncludes(covers, "ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
	assertStringIncludes(covers, "GROUP BY runs.run");
});

Deno.test("the price at a start is a definer that answers only a readable schedule, granted by name", () => {
	const body = fn(read(FUNCTIONS_SQL), "scheduling.fn_resolved_slot_fee");
	assertStringIncludes(body, "SECURITY DEFINER SET search_path = ''");
	assertStringIncludes(
		body,
		"IF NOT (scheduling.fn_schedule_is_public (p_schedule_id) OR scheduling.fn_can_manage_schedule (p_schedule_id)) THEN RETURN;",
	);
	assertStringIncludes(body, "COALESCE(band.amount, cs.fee_amount_minor)");

	const grants = read(GRANTS_SQL);
	assertStringIncludes(
		grants,
		"REVOKE ALL ON FUNCTION scheduling.fn_resolved_slot_fee (uuid, timestamptz) FROM PUBLIC;",
	);
	assertStringIncludes(
		grants,
		"GRANT EXECUTE ON FUNCTION scheduling.fn_resolved_slot_fee (uuid, timestamptz) TO anon, authenticated, service_role;",
	);
});
