/**
 * The cross-check between the preset limits the editor's schemas state and the ones the database
 * enforces (Decision #217). `scheduling.save_availability_preset` and the `recurrence_rules` CHECK
 * hold their figures in SQL strings, where a type-checker cannot see them drift: raised alone, the
 * database stores a preset the schema then refuses to read back; lowered alone, a preset the editor
 * accepted fails on save with no field to point at.
 *
 * A test over FILE CONTENT (the `coordination.contract.test.ts` technique), so it fails with no
 * database at the moment one side is edited without the other.
 */
import { assert, assertStringIncludes } from "@std/assert";
import { IsoDate } from "./civil.ts";
import {
	type AvailabilityRuleDraft,
	AvailabilityRuleDraftSchema,
	draftToRRule,
} from "./recurrence.ts";
import { SavePresetInputSchema } from "./presets.ts";
import { RecurrenceRuleRowSchema } from "./rows.ts";
import { SCHEDULE_TEMPLATES } from "./templates.ts";

const REPO = new URL("../../../", import.meta.url);
/** File text with line endings normalised, so an assertion never depends on how git checked it out. */
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const TABLES_SQL = "supabase/migrations/00000022_tables_scheduling.sql";
const FN_SQL = "supabase/migrations/00001510_functions_scheduling.sql";
const SEED_TS = "supabase/seeds/gen/emit-scheduling.ts";

function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined in ${FN_SQL}`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

const RULE: AvailabilityRuleDraft = SCHEDULE_TEMPLATES[0].rules[0];
const band = (hour: number) => ({ start: hour * 60, end: hour * 60 + 30 });

Deno.test("the save door caps rules and bands at the figures the schemas parse", () => {
	const body = functionBody(read(FN_SQL), "scheduling.save_availability_preset");
	assertStringIncludes(body, "jsonb_array_length(v_rules) > 64");
	assertStringIncludes(body, "jsonb_array_length(v_bands) > 6");

	const preset = { name: "Probe", timezone: "Europe/London", rules: [] };
	const unique = (n: number) => Array.from({ length: n }, (_, i) => ({ ...RULE, id: `r${i}` }));
	assert(SavePresetInputSchema.safeParse({ ...preset, rules: unique(64) }).success);
	assert(!SavePresetInputSchema.safeParse({ ...preset, rules: unique(65) }).success);

	const bands = (n: number) => Array.from({ length: n }, (_, i) => band(i + 1));
	assert(AvailabilityRuleDraftSchema.safeParse({ ...RULE, bands: bands(6) }).success);
	assert(!AvailabilityRuleDraftSchema.safeParse({ ...RULE, bands: bands(7) }).success);
});

Deno.test("the stored RRULE shape is the one the compiler emits, within the column's 400", () => {
	const sql = read(TABLES_SQL).replace(/\s+/g, " ");
	assertStringIncludes(
		sql,
		"rrule text NOT NULL CHECK (char_length(rrule) <= 400 AND rrule ~ '^FREQ=')",
	);
	assertStringIncludes(
		functionBody(read(FN_SQL), "scheduling.save_availability_preset"),
		"!~ '^FREQ='",
	);

	// The longest pattern the editor can author: every day of the month counted from the end, a
	// twelve-month interval, an end date and the widest "unless" condition.
	const longest = draftToRRule({
		pattern: {
			type: "monthly_date",
			days: Array.from({ length: 31 }, (_, i) => -(i + 1)),
			interval: 12,
		},
		condition: { unlessWeekdays: [0, 1, 2, 3, 4, 5] },
		startsOn: IsoDate.parse("2026-01-01"),
		endsOn: IsoDate.parse("2036-12-31"),
	});
	assert(longest.length <= 400, `a ${longest.length}-character RRULE would not fit the column`);
	assert(RecurrenceRuleRowSchema.shape.rrule.safeParse(longest).success);
});

Deno.test("every template rule compiles to an RRULE the database accepts", () => {
	for (const template of SCHEDULE_TEMPLATES) {
		for (const rule of template.rules) {
			const rrule = draftToRRule(rule);
			assert(
				rrule.startsWith("FREQ=") && rrule.length <= 400,
				`${template.key}/${rule.id}: ${rrule}`,
			);
			assert(rule.bands.length <= 6, `${template.key}/${rule.id} has more than six bands`);
		}
	}
});

Deno.test("the seed builds its presets from SCHEDULE_TEMPLATES, never a hand copy", () => {
	const seed = read(SEED_TS);
	assertStringIncludes(seed, 'SCHEDULE_TEMPLATES.find((t) => t.key === "general")');
	assertStringIncludes(seed, "draftToRRule(rule)");
});
