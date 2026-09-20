/**
 * The cross-check between the intake SSOT and the three columns that store an intake list.
 *
 * `INTAKE_FIELDS_MAX` is enforced twice: by `IntakeFieldsSchema` here, and by a `CHECK` on each jsonb
 * column in the migrations (`service_blueprints.intake_fields`, `freelancer_profiles.hire_intake`,
 * `teams.hire_intake`). A cap that fell out of step would not fail loudly — the route would accept a
 * thirteenth field the database then refuses, or the database would keep a thirteenth the renderer
 * caps away — so, like `slug.contract.test.ts`, this reads the migration text and asserts the SQL
 * literal agrees with the constant. File content, not a live query: it must fail with no database.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { INTAKE_FIELDS_MAX } from "./intake.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const INTAKE_COLUMNS = [
	{
		file: "supabase/migrations/00000014_tables_marketplace.sql",
		column: "intake_fields",
		constraint: "ck_service_blueprints_intake_shape",
	},
	{
		file: "supabase/migrations/00000011_tables_org.sql",
		column: "hire_intake",
		constraint: "ck_freelancer_profiles_hire_intake_shape",
	},
	{
		file: "supabase/migrations/00000011_tables_org.sql",
		column: "hire_intake",
		constraint: "ck_teams_hire_intake_shape",
	},
] as const;

Deno.test("every intake column caps its array at INTAKE_FIELDS_MAX, in the SQL", () => {
	for (const { file, column, constraint } of INTAKE_COLUMNS) {
		const sql = read(file);
		const at = sql.indexOf(`CONSTRAINT ${constraint} CHECK (`);
		if (at < 0) throw new Error(`${constraint} missing from ${file}`);
		// The constraint spans two lines; read to the close of its CHECK.
		const body = sql.slice(at, sql.indexOf("\n    )", at));
		assertStringIncludes(body, `jsonb_typeof(${column}) = 'array'`);
		const cap = body.match(/jsonb_array_length\((\w+)\) <= (\d+)/);
		if (!cap) throw new Error(`${constraint} carries no array-length cap`);
		assertEquals(cap[1], column);
		assertEquals(Number(cap[2]), INTAKE_FIELDS_MAX, `${constraint} cap`);
	}
});

Deno.test("an intake column defaults to an empty array, never NULL", () => {
	for (const { file, column } of INTAKE_COLUMNS) {
		assertStringIncludes(read(file), `${column} jsonb NOT NULL DEFAULT '[]'::jsonb`);
	}
});
