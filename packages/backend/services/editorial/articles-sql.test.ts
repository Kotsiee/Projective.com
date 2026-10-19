import { assert, assertEquals, assertMatch } from "@std/assert";
import {
	EDITORIAL_ARTICLE_AUTHOR_KINDS,
	EDITORIAL_ARTICLE_STATUSES,
	EDITORIAL_ARTICLE_TOPICS,
} from "@projective/types/editorial";

/**
 * The SQL twins of Projective's article rules (P6, Decision #271). The database cannot import the
 * TypeScript lists, so this pins each list the migrations spell out to its `@projective/types`
 * source, and checks every statement sits in the `[articles]` / `[editorial.articles]` region of its
 * category file (Decision #274 (F)) — the generated seed's freshness is `content-sql.test.ts`'s job.
 */

const MIGRATIONS = new URL("../../../../supabase/migrations/", import.meta.url);

/** The body of `-- #region [name] …` in a migration file. */
async function region(file: string, name: string): Promise<string> {
	const text = (await Deno.readTextFile(new URL(file, MIGRATIONS))).replace(/\r\n/g, "\n");
	const start = text.indexOf(`-- #region [${name}]`);
	assert(start >= 0, `${file} has no [${name}] region`);
	const end = text.indexOf("-- #endregion", start);
	return text.slice(start, end);
}

/** The quoted values of an `ARRAY['a', 'b']` or `IN ('a', 'b')` list following `marker`. */
function quotedList(sql: string, marker: RegExp): string[] {
	const match = marker.exec(sql);
	assert(match, `no list matching ${marker}`);
	return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

Deno.test("the topics CHECK lists exactly EDITORIAL_ARTICLE_TOPICS, in order", async () => {
	const tables = await region("00000024_tables_editorial.sql", "articles");
	assertEquals(
		quotedList(tables, /topics <@ ARRAY\[([^\]]+)\]::text\[\]/),
		[...EDITORIAL_ARTICLE_TOPICS],
	);
});

Deno.test("the status and author-kind CHECKs list exactly the TypeScript lifecycles", async () => {
	const tables = await region("00000024_tables_editorial.sql", "articles");
	assertEquals(
		quotedList(tables, /articles_status_check CHECK \(status IN \(([^)]+)\)\)/),
		[...EDITORIAL_ARTICLE_STATUSES],
	);
	assertEquals(
		quotedList(tables, /article_authors_kind_check CHECK \(kind IN \(([^)]+)\)\)/),
		[...EDITORIAL_ARTICLE_AUTHOR_KINDS],
	);
});

Deno.test("both tables are created in the [articles] region, keyed by slug, authors first", async () => {
	const tables = await region("00000024_tables_editorial.sql", "articles");
	const authors = tables.indexOf("CREATE TABLE IF NOT EXISTS editorial.article_authors");
	const articles = tables.indexOf("CREATE TABLE IF NOT EXISTS editorial.articles");
	assert(authors >= 0 && articles > authors, "authors are created before the articles naming them");
	assertMatch(tables, /author_slug text NOT NULL REFERENCES editorial\.article_authors \(slug\)/);
	assertEquals(tables.match(/slug text PRIMARY KEY/g)?.length, 2);
});

Deno.test("each table has RLS, one SELECT policy matching the visible predicate, SELECT-only grants", async () => {
	const rls = await region("00002001_policies_enable_rls.sql", "editorial.articles");
	assertMatch(rls, /ALTER TABLE editorial\.article_authors ENABLE ROW LEVEL SECURITY;/);
	assertMatch(rls, /ALTER TABLE editorial\.articles ENABLE ROW LEVEL SECURITY;/);

	const policies = await region("00002021_policies_editorial_community.sql", "editorial.articles");
	assertEquals(policies.match(/CREATE POLICY/g)?.length, 2);
	assertEquals(policies.match(/FOR SELECT TO anon, authenticated/g)?.length, 2);
	assertMatch(policies, /USING \(status = 'published' AND published_at <= now\(\)\);/);

	const grants = await region("00002520_permissions_table_grants.sql", "editorial.articles");
	assertEquals(
		grants.trim().split("\n").filter((line) => line.startsWith("GRANT")),
		["GRANT SELECT ON editorial.article_authors, editorial.articles TO anon, authenticated;"],
	);
});

Deno.test("both slugs are guarded by the shared immutability trigger", async () => {
	const triggers = await region("00001898_triggers_editorial_community.sql", "editorial.articles");
	for (const table of ["article_authors", "articles"]) {
		assertMatch(
			triggers,
			new RegExp(
				`BEFORE UPDATE OF slug ON editorial\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION editorial\\.fn_guard_slug_immutable\\(\\);`,
			),
		);
	}
});
