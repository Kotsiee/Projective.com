/**
 * The cross-check between the NDA mapping stated here and the one `projects.create_project` performs.
 *
 * A create payload speaks in {@link NdaMode} — `none | platform_standard | custom` — and the row
 * stores a PAIR: `nda_required` (does one apply) and `nda_source` (which instrument). The mapping
 * between the two shapes is `ndaRequiredFor` / `ndaSourceFor` / `ndaDocumentFor`, and it has to exist
 * twice, because the only caller that needs it is a `plpgsql` function that cannot import TypeScript.
 *
 * Two implementations of one mapping is the drift this file exists to catch, and it is drift a
 * type-checker cannot see: SQL is a string as far as TypeScript is concerned. It has already cost
 * this codebase a fully broken create path — the RPC's INSERT named `nda_mode`, which is the enum
 * TYPE and has never been a COLUMN, so every call raised `42703 column "nda_mode" of relation
 * "projects" does not exist`. The statement parsed, the function created cleanly, and nothing failed
 * until somebody actually called it.
 *
 * So this reads the migrations and asserts the SQL agrees. Deliberately a test over FILE CONTENT
 * rather than a live query: it has to fail in CI and on a laptop with no database, at the moment
 * somebody edits one side and not the other.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ndaDocumentFor, NdaMode, ndaRequiredFor, ndaSourceFor } from "./create.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const TABLE_SQL = "supabase/migrations/00000015_tables_projects.sql";
const RPC_SQL = "supabase/migrations/00001100_functions_projects_read_access.sql";

/**
 * The column list of `create_project`'s INSERT INTO projects.projects (…).
 *
 * Extracted rather than searched for as a substring, because `nda_mode` appears legitimately all over
 * that file — as a cast (`::projects.nda_mode`), as a variable (`v_nda_mode`) and in prose. Only its
 * appearance HERE is the defect, so only here is what gets asserted.
 */
function insertColumns(): string[] {
	const sql = read(RPC_SQL);
	const start = sql.indexOf("INSERT INTO projects.projects (");
	assert(start >= 0, "create_project no longer inserts into projects.projects");
	const open = sql.indexOf("(", start);
	const close = sql.indexOf(")", open);
	return sql.slice(open + 1, close).split(",").map((c) => c.trim()).filter(Boolean);
}

// #region The pair exists, and the phantom does not
Deno.test("projects.projects stores the PAIR, and has no nda_mode column", () => {
	const sql = read(TABLE_SQL);
	assertStringIncludes(sql, "nda_required boolean NOT NULL");
	assertStringIncludes(sql, "nda_source text NOT NULL DEFAULT 'platform'");
	// The whole point. A column of this name would make the enum type and the column indistinguishable
	// by eye, which is how the RPC came to write to one believing it was the other.
	assert(
		!/^\s*nda_mode\s+\S/m.test(sql),
		"projects.projects declares an nda_mode COLUMN — if that is intended, this whole mapping is " +
			"obsolete and create_project should write it directly",
	);
});

Deno.test("create_project inserts nda_source, never nda_mode", () => {
	const cols = insertColumns();
	assert(
		cols.includes("nda_source"),
		`INSERT column list is missing nda_source: ${cols.join(", ")}`,
	);
	assert(cols.includes("nda_required"), "INSERT column list is missing nda_required");
	assert(
		!cols.includes("nda_mode"),
		"create_project inserts into `nda_mode`, a column that does not exist — every call raises 42703",
	);
});

Deno.test("the pair is written together, so a row cannot half-describe its own terms", () => {
	const cols = insertColumns();
	// Writing one without the other would let the boolean and the instrument disagree about whether
	// work is confidential, which is the failure the pairing exists to prevent.
	assertEquals(
		cols.includes("nda_required"),
		cols.includes("nda_source"),
		"one half of the NDA pair is written without the other",
	);
});
// #endregion

// #region The mapping matches
Deno.test("the SQL derives nda_required exactly as ndaRequiredFor does", () => {
	// `ndaRequiredFor` is `mode !== "none"`; the SQL is `v_nda_mode <> 'none'`.
	assertStringIncludes(read(RPC_SQL), "v_nda_mode <> 'none'::projects.nda_mode,");
	assertEquals(ndaRequiredFor("none"), false);
	assertEquals(ndaRequiredFor("platform_standard"), true);
	assertEquals(ndaRequiredFor("custom"), true);
});

Deno.test("the SQL derives nda_source exactly as ndaSourceFor does", () => {
	// `ndaSourceFor` is `mode === "custom" ? "custom" : "platform"`; the SQL is the same CASE.
	assertStringIncludes(
		read(RPC_SQL),
		"CASE WHEN v_nda_mode = 'custom'::projects.nda_mode THEN 'custom' ELSE 'platform' END,",
	);
	assertEquals(ndaSourceFor("custom"), "custom");
	// Both non-custom modes collapse to `platform`. `none` lands there because the column is NOT NULL
	// with two members and `platform` is its own DEFAULT — the value is meaningless while
	// `nda_required` is false, and nothing reads it.
	assertEquals(ndaSourceFor("platform_standard"), "platform");
	assertEquals(ndaSourceFor("none"), "platform");
});

Deno.test("every mode maps to a value the column's CHECK accepts", () => {
	// The pair carries more states than the enum, so the mapping is total in one direction only. This
	// asserts the direction that matters: no mode can produce a value the row would refuse.
	const permitted = new Set(["platform", "custom"]);
	for (const mode of NdaMode.options) {
		assert(permitted.has(ndaSourceFor(mode)), `${mode} maps outside the column's CHECK`);
	}
	assertStringIncludes(read(TABLE_SQL), "nda_source IN ('platform', 'custom')");
});

Deno.test("only a custom NDA may name a document, in both the mapping and the CHECK", () => {
	assertEquals(ndaDocumentFor("custom", "file-1"), "file-1");
	assertEquals(ndaDocumentFor("platform_standard", "file-1"), null);
	assertEquals(ndaDocumentFor("none", "file-1"), null);
	// The CHECK keys on `nda_source`, not on a mode — which is what makes `ndaSourceFor` load-bearing
	// rather than cosmetic: get the source wrong and a legitimate custom NDA is refused its document.
	assertStringIncludes(
		read(TABLE_SQL),
		"CONSTRAINT ck_projects_nda_document CHECK (nda_source = 'custom' OR nda_document_id IS NULL)",
	);
});
// #endregion
