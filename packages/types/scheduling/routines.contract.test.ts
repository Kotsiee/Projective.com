/**
 * The cross-check for routines and availability behaviour (Decision #389): the SQL's vocabulary and
 * bounds against the Zod that mirrors them, the column grants every `/calendar` read depends on, and
 * the two rules a future edit could break without any test near it noticing: no visitor reads a
 * routine, and both busy readers skip a passive entry.
 *
 * Over FILE CONTENT (the `presets.contract.test.ts` technique), so it fails with no database the moment
 * one side is edited without the other. `supabase/probes/scheduling_routines.sql` proves the behaviour.
 */
import { assert, assertFalse, assertStringIncludes } from "@std/assert";
import { mintSlug } from "../slugs/slug.ts";
import { AvailabilityBehavior, SchedulingEventRowSchema } from "./rows.ts";
import {
	CreateRoutineInputSchema,
	OrganiseEntryInputSchema,
	ROUTINE_NAME_MAX,
	RoutineSchema,
	UpdateRoutineInputSchema,
} from "./routines.ts";
import { PUBLIC_EVENT_FIELDS } from "./privacy.ts";

const REPO = new URL("../../../", import.meta.url);
/** File text with whitespace collapsed, so an assertion never depends on line endings or wrapping. */
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\s+/g, " ");

const TABLES_SQL = "supabase/migrations/00000022_tables_scheduling.sql";
const FUNCTIONS_SQL = "supabase/migrations/00001510_functions_scheduling.sql";
const FREE_BUSY_SQL = "supabase/migrations/00001520_functions_scheduling_free_busy.sql";
const POLICIES_SQL = "supabase/migrations/00002015_policies_scheduling_integrations.sql";
const GRANTS_SQL = "supabase/migrations/00002520_permissions_table_grants.sql";
const TRIGGERS_SQL = "supabase/migrations/00001860_triggers_scheduling.sql";

const ID = "11111111-1111-4111-8111-111111111111";

function routine(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: ID,
		scheduleId: ID,
		name: "Gym",
		slug: mintSlug("routine"),
		colorToken: "--primary",
		isActive: true,
		behavior: "passive",
		recurrenceRule: null,
		metadata: {},
		createdAt: "2026-11-05T08:00:00+00:00",
		updatedAt: "2026-11-05T08:00:00+00:00",
		...over,
	};
}

Deno.test("both columns state the vocabulary AvailabilityBehavior parses", () => {
	const sql = read(TABLES_SQL);
	const values = AvailabilityBehavior.options.map((v) => `'${v}'`).join(", ");
	assertStringIncludes(
		sql,
		`behavior text NOT NULL DEFAULT 'passive' CHECK (behavior IN (${values}))`,
	);
	assertStringIncludes(
		sql,
		`availability_behavior text NOT NULL DEFAULT 'disruptive' CHECK (availability_behavior IN (${values}))`,
	);
});

Deno.test("a routine's name stops at the same figure on both sides", () => {
	assertStringIncludes(
		read(TABLES_SQL),
		`name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND ${ROUTINE_NAME_MAX})`,
	);
	const of = (n: number) => routine({ name: "a".repeat(n) });
	assert(RoutineSchema.safeParse(of(ROUTINE_NAME_MAX)).success);
	assertFalse(RoutineSchema.safeParse(of(ROUTINE_NAME_MAX + 1)).success);
	assertFalse(CreateRoutineInputSchema.safeParse({ name: "   " }).success);
});

Deno.test("a colour is a token name, on both sides", () => {
	assertStringIncludes(read(TABLES_SQL), "CHECK (color_token ~ '^--[a-z][a-z0-9-]{0,58}$')");
	assert(UpdateRoutineInputSchema.safeParse({ id: ID, colorToken: "--accent-2" }).success);
	for (const bad of ["#ff0000", "red", "--x;background:url(x)", `--${"a".repeat(60)}`]) {
		assertFalse(UpdateRoutineInputSchema.safeParse({ id: ID, colorToken: bad }).success, bad);
	}
});

Deno.test("a row round-trips, and an entry may not name a routine outside its schedule", () => {
	assert(RoutineSchema.safeParse(routine({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" })).success);
	assertFalse(RoutineSchema.safeParse(routine({ slug: "avp-2222222222" })).success);
	assertFalse(RoutineSchema.safeParse(routine({ behavior: "tentative" })).success);
	assert(OrganiseEntryInputSchema.safeParse({ eventId: ID, routineId: null }).success);

	const sql = read(TABLES_SQL);
	assertStringIncludes(
		sql,
		"FOREIGN KEY (routine_id, schedule_id) REFERENCES scheduling.routines (id, schedule_id) ON DELETE SET NULL (routine_id)",
	);
	assert("routineId" in SchedulingEventRowSchema.shape);
	assert("availabilityBehavior" in SchedulingEventRowSchema.shape);
});

Deno.test("no busy reader counts a passive entry, and the two say it the same way", () => {
	const skip = "e.availability_behavior <> 'passive'";
	assertStringIncludes(read(FUNCTIONS_SQL), skip);
	assertStringIncludes(read(FREE_BUSY_SQL), skip);
});

Deno.test("a provider hears when an entry stops blocking time, and never about a routine", () => {
	const trigger = read(TRIGGERS_SQL).match(
		/CREATE OR REPLACE TRIGGER trg_event_mirrors AFTER INSERT OR UPDATE OF ([^]*?) ON scheduling\.events/,
	);
	assert(trigger, "trg_event_mirrors moved");
	const columns = trigger[1].split(",").map((c) => c.trim());
	assert(columns.includes("availability_behavior"));
	assertFalse(columns.includes("routine_id"));
	assertStringIncludes(read(TRIGGERS_SQL), "WHEN (NEW.source_connection_id IS NULL");
});

Deno.test("a routine is its owner's: no visitor reads one, and nobody deletes one", () => {
	const policies = read(POLICIES_SQL);
	const view = policies.match(/CREATE POLICY "View routines"[^;]*;/);
	assert(view, "the routines read policy moved");
	assertFalse(view[0].includes("anon"));
	assertFalse(view[0].includes("fn_schedule_is_public"));

	const grants = read(GRANTS_SQL);
	assertFalse(/GRANT[^;]*\bDELETE\b[^;]*scheduling\.routines/.test(grants));
	assertFalse(/GRANT[^;]*scheduling\.routines[^;]*\banon\b/.test(grants));
	assert(!PUBLIC_EVENT_FIELDS.includes("routineId" as never));
	assert(!PUBLIC_EVENT_FIELDS.includes("availabilityBehavior" as never));
});

Deno.test("a client role may read both event columns, or every /calendar read is refused", () => {
	const grant = read(GRANTS_SQL).match(
		/GRANT SELECT \(([^)]*)\) ON TABLE scheduling\.events TO authenticated/,
	);
	assert(grant, "the column-level SELECT grant on scheduling.events moved");
	const columns = grant[1].split(",").map((c) => c.trim());
	for (const column of ["routine_id", "availability_behavior"]) {
		assert(columns.includes(column), `${column} is not granted to authenticated`);
	}
});
