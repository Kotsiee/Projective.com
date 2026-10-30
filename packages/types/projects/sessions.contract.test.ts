/**
 * The sitting doors' limits, stated twice: here (`ScheduleSittingInputSchema`,
 * `RetitleSittingInputSchema`) and in `projects.schedule_sitting` / `projects.retitle_sitting`
 * (`00001155` §4c), which cannot import TypeScript. A form that accepted a 25-hour sitting the
 * database then refused would be a control that renders and does nothing, so this reads the migration
 * and asserts the two agree — a test over FILE CONTENT, so it fails with no database at hand.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
	RetitleSittingInputSchema,
	ScheduleSittingInputSchema,
	SITTING_MAX_HOURS,
	SITTING_TITLE_MAX,
} from "./sessions.ts";

const REPO = new URL("../../../", import.meta.url);
const SESSIONS_SQL = "supabase/migrations/00001155_functions_projects_sessions.sql";

/** The body of one `CREATE OR REPLACE FUNCTION`, up to its closing dollar quote. */
function functionBody(name: string): string {
	const sql = Deno.readTextFileSync(new URL(SESSIONS_SQL, REPO));
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined in ${SESSIONS_SQL}`);
	const open = sql.indexOf("$$", start);
	const close = sql.indexOf("$$", open + 2);
	return sql.slice(open, close);
}

const COHORT = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const START = "2026-11-02T10:00:00.000Z";

// #region The SQL states the same limits
Deno.test("schedule_sitting refuses the span and title the schema refuses", () => {
	const body = functionBody("projects.schedule_sitting");
	assertStringIncludes(body, `INTERVAL '${SITTING_MAX_HOURS} hours'`);
	assertStringIncludes(body, `pg_catalog.length(v_title) > ${SITTING_TITLE_MAX}`);
});

Deno.test("retitle_sitting refuses the title the schema refuses", () => {
	assertStringIncludes(
		functionBody("projects.retitle_sitting"),
		`pg_catalog.length(v_title) > ${SITTING_TITLE_MAX}`,
	);
});
// #endregion

// #region The schema
Deno.test("a sitting up to the maximum length is accepted, one minute over is not", () => {
	const end = (hours: number, minutes = 0) =>
		new Date(Date.parse(START) + hours * 3_600_000 + minutes * 60_000).toISOString();
	const at = (endsAt: string) =>
		ScheduleSittingInputSchema.safeParse({
			cohortId: COHORT,
			title: "Week 1",
			startsAt: START,
			endsAt,
		})
			.success;
	assert(at(end(1)));
	assert(at(end(SITTING_MAX_HOURS)));
	assertEquals(at(end(SITTING_MAX_HOURS, 1)), false);
	assertEquals(at(START), false);
	assertEquals(at(end(-1)), false);
});

Deno.test("a title is trimmed, never blank, and bounded", () => {
	const parse = (title: string) =>
		RetitleSittingInputSchema.safeParse({ sittingId: COHORT, title });
	const ok = parse("  Week 2: critique  ");
	assert(ok.success);
	assertEquals(ok.data.title, "Week 2: critique");
	assertEquals(parse("   ").success, false);
	assert(parse("x".repeat(SITTING_TITLE_MAX)).success);
	assertEquals(parse("x".repeat(SITTING_TITLE_MAX + 1)).success, false);
});
// #endregion
