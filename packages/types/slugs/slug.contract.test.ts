/**
 * The cross-check between the TypeScript minter and its Postgres twin.
 *
 * A slug is minted in two places: `mintSlug` here, and `security.mint_slug` in
 * `00001001_functions_security_context.sql` — the second so that a row inserted by a path which
 * supplies no slug still gets a canonical address. Two implementations of one format is the drift this
 * codebase keeps paying for, and it is a drift a type-checker cannot see: SQL is a string as far as
 * TypeScript is concerned, and a `CHECK` that has fallen out of step still parses, still applies, and
 * simply starts refusing addresses the application believes are legal.
 *
 * So this reads the migrations and asserts the SQL agrees with the constants, character for character.
 * It is deliberately a test over FILE CONTENT rather than a live query: it has to fail in CI and on a
 * laptop with no database, at the moment somebody edits one side and not the other.
 *
 * Run from the repository root — the paths below are resolved relative to this file, so the location
 * of the test runner does not matter.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { SLUG_ALPHABET, SLUG_BODY_LENGTH, SLUG_PREFIXES, SLUGGED_ENTITIES } from "./slug.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const FUNCTIONS_SQL = "supabase/migrations/00001001_functions_security_context.sql";
const TRIGGERS_SQL = "supabase/migrations/00001890_triggers_slugs.sql";

/** Every table that carries a slug, with the migration and prefix that own it. */
const SLUGGED_TABLES = [
	{
		entity: "project" as const,
		table: "projects.projects",
		constraint: "ck_projects_slug_shape",
		unique: "projects_slug_key",
		file: "supabase/migrations/00000015_tables_projects.sql",
	},
	{
		entity: "stage" as const,
		table: "projects.project_stages",
		constraint: "ck_project_stages_slug_shape",
		unique: "project_stages_slug_key",
		file: "supabase/migrations/00000015_tables_projects.sql",
	},
	{
		entity: "service" as const,
		table: "marketplace.service_blueprints",
		constraint: "ck_service_blueprints_slug_shape",
		unique: "service_blueprints_slug_key",
		file: "supabase/migrations/00000014_tables_marketplace.sql",
	},
	{
		entity: "session" as const,
		table: "projects.session_events",
		constraint: "ck_session_events_slug_shape",
		unique: "session_events_slug_key",
		file: "supabase/migrations/00000015_tables_projects.sql",
	},
	{
		entity: "ticket" as const,
		table: "projects.tickets",
		constraint: "ck_tickets_slug_shape",
		unique: "tickets_slug_key",
		file: "supabase/migrations/00000015_tables_projects.sql",
	},
];

// #region The minter
Deno.test("security.mint_slug draws from the SAME alphabet as mintSlug", () => {
	const sql = read(FUNCTIONS_SQL);
	assertStringIncludes(
		sql,
		`'${SLUG_ALPHABET}'`,
		`security.mint_slug must draw from SLUG_ALPHABET verbatim. If the two ever differ, the ` +
			`database mints addresses the application's own pattern refuses.`,
	);
});

Deno.test("security.mint_slug produces the SAME number of symbols", () => {
	const sql = read(FUNCTIONS_SQL);
	assertStringIncludes(
		sql,
		`generate_series(1, ${SLUG_BODY_LENGTH})`,
		"the SQL minter's body length must equal SLUG_BODY_LENGTH",
	);
	// The modulo has to be the alphabet's width, or the draw is biased and the tail symbols are
	// unreachable. Asserted as a literal because that is how it is written in the SQL.
	assertStringIncludes(sql, `% ${SLUG_ALPHABET.length}) + 1`);
});

Deno.test("neither SQL helper is callable over PostgREST", () => {
	// `security` is an exposed schema and CREATE FUNCTION grants EXECUTE to PUBLIC by default, so the
	// revoke is what keeps these off the public API. Nothing legitimate breaks by revoking BECAUSE the
	// guard is a definer (below) — not, as this comment used to claim, because a trigger runs as the
	// table owner. It does not.
	const sql = read(FUNCTIONS_SQL);
	assertStringIncludes(sql, "REVOKE ALL ON FUNCTION security.mint_slug(text) FROM PUBLIC;");
	assertStringIncludes(sql, "REVOKE ALL ON FUNCTION security.fn_slug_guard() FROM PUBLIC;");
});

Deno.test("the slug guard is SECURITY DEFINER, or every insert into a slugged table fails", () => {
	// THE REGRESSION THIS EXISTS FOR. A trigger function runs as the INVOKING role: Postgres checks
	// EXECUTE on the trigger function once, at CREATE TRIGGER time, but a call the body then makes to
	// another function is checked at runtime against whoever fired it. So while this guard was
	// SECURITY INVOKER, its call to the (correctly) revoked `security.mint_slug` failed for every
	// client role, and `INSERT INTO projects.projects` answered
	// `permission denied for function mint_slug` — raised from inside a function the caller never
	// named, on a statement that mentions no slug at all.
	//
	// Asserted over the function's own header rather than the file, because `SECURITY DEFINER` appears
	// throughout these migrations and a file-wide match would pass while this one function lost it.
	const sql = read(FUNCTIONS_SQL);
	const open = sql.indexOf("CREATE OR REPLACE FUNCTION security.fn_slug_guard()");
	assert(open !== -1, "security.fn_slug_guard must be defined in " + FUNCTIONS_SQL);
	const header = sql.slice(open, sql.indexOf("AS $$", open));
	assertStringIncludes(
		header,
		"SECURITY DEFINER",
		"security.fn_slug_guard() must be SECURITY DEFINER. As the invoker it cannot call " +
			"security.mint_slug, which is revoked from PUBLIC, so no client role could insert a row " +
			"into any slugged table.",
	);
});

Deno.test("the minter is never granted to a client role", () => {
	// The other half of the same rule, and the wrong fix somebody will reach for first. Answering a
	// `permission denied for function mint_slug` with a GRANT makes `POST /rpc/mint_slug` callable by
	// anyone signed in — and by `anon` — which is the exact surface the REVOKE removes. The guard
	// being a definer is what makes the grant unnecessary.
	//
	// A literal substring rather than a pattern: every grant in these files is written on one line in
	// this exact form, and a regex here has to survive more layers of escaping than the rule is worth.
	const GRANTS = "supabase/migrations/00002510_permissions_function_grants.sql";
	for (const file of [FUNCTIONS_SQL, GRANTS]) {
		assert(
			!read(file).toUpperCase().includes("GRANT EXECUTE ON FUNCTION SECURITY.MINT_SLUG"),
			`${file} must not GRANT EXECUTE on security.mint_slug — make the caller a definer instead.`,
		);
	}
});
// #endregion

// #region The columns
Deno.test("every slugged table's CHECK is exactly the pattern this module produces", () => {
	for (const t of SLUGGED_TABLES) {
		const sql = read(t.file);
		const expected = `CHECK (slug ~ '^${SLUG_PREFIXES[t.entity]}-[${SLUG_ALPHABET}]{${SLUG_BODY_LENGTH}}$')`;
		assertStringIncludes(
			sql,
			expected,
			`${t.table}: ${t.constraint} must be ${expected}. A CHECK that has drifted from the minter ` +
				`refuses addresses the application believes are legal, at insert time, in production.`,
		);
	}
});

Deno.test("every slugged column is NOT NULL with no DEFAULT, and UNIQUE", () => {
	for (const t of SLUGGED_TABLES) {
		const sql = read(t.file);
		// NO DEFAULT is the load-bearing half: the trigger fills the column BEFORE the NOT NULL is
		// checked, and a DEFAULT would have to be a second, inline implementation of the minter.
		assertStringIncludes(sql, "slug text NOT NULL,", `${t.table}: slug must be NOT NULL`);
		assert(
			!/slug text NOT NULL DEFAULT/.test(sql),
			`${t.table}: a slug DEFAULT would be a second minter to keep in step with the first`,
		);
		assertStringIncludes(
			sql,
			`CONSTRAINT ${t.unique} UNIQUE (slug)`,
			`${t.table}: the unique index is what the insert retry detects a collision from`,
		);
	}
});

Deno.test("every slugged table has a fill-and-pin trigger, with the RIGHT prefix", () => {
	const sql = read(TRIGGERS_SQL);
	for (const t of SLUGGED_TABLES) {
		assertStringIncludes(
			sql,
			`BEFORE INSERT OR UPDATE ON ${t.table}`,
			`${t.table} has no slug trigger, so an insert that supplies none violates NOT NULL`,
		);
	}
	// The prefix is the one thing a copy-paste gets wrong silently: a stage table given `'prj'` mints
	// perfectly valid addresses that its own CHECK then refuses — or worse, that resolve against
	// another table's namespace.
	for (const entity of SLUGGED_ENTITIES) {
		assertStringIncludes(sql, `security.fn_slug_guard('${SLUG_PREFIXES[entity]}')`);
	}
	assertEquals(
		[...sql.matchAll(/security\.fn_slug_guard\('([a-z]{3})'\)/g)].map((m) => m[1]).sort(),
		SLUGGED_ENTITIES.map((e) => SLUG_PREFIXES[e]).sort(),
		"the trigger file must declare exactly one guard per slugged entity, with no prefix repeated",
	);
});
// #endregion
