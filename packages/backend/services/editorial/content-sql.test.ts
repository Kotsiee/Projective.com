import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { z } from "zod";
import { RowMapperError } from "../../core/row-mapper.ts";
import { emitEditorialSeed, emitTableSql, sqlIdentifier, sqlValue } from "./content-sql.ts";
import {
	defineEditorialSurface,
	defineEditorialTable,
	editorialContent,
} from "./editorial-source.ts";
import { EDITORIAL_SEEDS } from "./content/mod.ts";

/**
 * The editorial seed generator: what each value becomes in SQL, the shape of a table's upsert, and —
 * the drift test — that every committed `0000507x_seed_editorial_*.sql` is exactly what its content
 * source emits today, so a source edited without regenerating (or a file edited by hand) fails here.
 */

// #region Literals
Deno.test("scalars, NULL and DEFAULT", () => {
	assertEquals(sqlValue("it's"), "'it''s'");
	assertEquals(sqlValue(42), "42");
	assertEquals(sqlValue(true), "true");
	assertEquals(sqlValue(null), "NULL");
	assertEquals(sqlValue(undefined), "DEFAULT");
	assertEquals(sqlValue("2026-10-17", "date"), "'2026-10-17'::date");
	assertEquals(sqlValue("ready", "community.idea_status"), "'ready'::community.idea_status");
});

Deno.test("an array is jsonb unless its cast names an array type", () => {
	assertEquals(sqlValue(["a", "b"], "text[]"), "ARRAY['a', 'b']::text[]");
	assertEquals(sqlValue([], "text[]"), "'{}'::text[]");
	assertEquals(sqlValue(["a"]), `'["a"]'::jsonb`);
});

Deno.test("JSON is quoted for SQL and survives quotes and backslashes", () => {
	const body = [{ type: "p", text: `Don't "quote" me \\ please` }];
	const literal = sqlValue(body);
	assertEquals(literal, `'${JSON.stringify(body).replace(/'/g, "''")}'::jsonb`);
	assertStringIncludes(literal, "Don''t");
});

Deno.test("values SQL cannot hold are refused", () => {
	assertThrows(() => sqlValue(Number.NaN), TypeError, "finite");
	assertThrows(() => sqlValue("a\0b"), TypeError, "NUL");
	assertThrows(() => sqlValue([{ nested: true }], "text[]"), TypeError, "scalars");
	// JSON.stringify writes NUL as `\u0000`, which passes a text check but Postgres refuses in jsonb.
	assertThrows(() => sqlValue([{ type: "p", text: "a\0b" }]), TypeError, "jsonb");
	assertThrows(() => sqlValue({ ["k\0"]: 1 }), TypeError, "jsonb");
	assertThrows(() => sqlValue({ deep: [{ deeper: ["\0"] }] }), TypeError, "jsonb");
});

Deno.test("a literal backslash-u0000 in a jsonb string is text, not NUL, and is kept", () => {
	assertEquals(sqlValue({ code: "\\u0000" }), `'{"code":"\\\\u0000"}'::jsonb`);
});

Deno.test("column names are validated and double-quoted", () => {
	assertEquals(sqlIdentifier("order"), `"order"`);
	assertEquals(sqlIdentifier("published_on"), `"published_on"`);
	for (const bad of ["Order", "two words", `x"y`, "1st", "a-b", ""]) {
		assertThrows(() => sqlIdentifier(bad), TypeError, "identifier");
	}
});
// #endregion

// #region Statements
const Row = z.object({
	slug: z.string(),
	title: z.string(),
	roles: z.array(z.string()),
	body: z.array(z.object({ type: z.string(), text: z.string() })),
	sort: z.number().optional(),
});
type Row = z.infer<typeof Row>;

const articles = defineEditorialTable<Row, Row>({
	table: "editorial.help_articles",
	key: ["slug"],
	row: Row,
	casts: { roles: "text[]" },
	toRow: (r) => r,
	fromRow: (r) => r,
});

Deno.test("a table emits one multi-row upsert on its natural key", () => {
	const sql = emitTableSql(editorialContent(articles, [
		{
			slug: "funding",
			title: "Funding",
			roles: ["client"],
			body: [{ type: "p", text: "Hi" }],
			sort: 1,
		},
		{ slug: "payouts", title: "Payouts", roles: [], body: [] },
	]));
	assertEquals(
		sql,
		[
			"-- #region editorial.help_articles (2 rows)",
			`INSERT INTO editorial.help_articles ("slug", "title", "roles", "body", "sort")`,
			"VALUES",
			`    ('funding', 'Funding', ARRAY['client']::text[], '[{"type":"p","text":"Hi"}]'::jsonb, 1),`,
			"    ('payouts', 'Payouts', '{}'::text[], '[]'::jsonb, DEFAULT)",
			`ON CONFLICT ("slug") DO UPDATE SET`,
			`    "title" = EXCLUDED."title",`,
			`    "roles" = EXCLUDED."roles",`,
			`    "body" = EXCLUDED."body",`,
			`    "sort" = EXCLUDED."sort";`,
			"-- #endregion",
			"",
		].join("\n"),
	);
});

Deno.test("a reserved-word column is quoted everywhere it is named", () => {
	const Ordered = z.object({ slug: z.string(), order: z.number() });
	const ordered = defineEditorialTable<z.infer<typeof Ordered>, z.infer<typeof Ordered>>({
		table: "editorial.help_categories",
		key: ["slug"],
		row: Ordered,
		toRow: (r) => r,
		fromRow: (r) => r,
	});
	const sql = emitTableSql(editorialContent(ordered, [{ slug: "start", order: 1 }]));
	assertStringIncludes(sql, `INSERT INTO editorial.help_categories ("slug", "order")`);
	assertStringIncludes(sql, `    "order" = EXCLUDED."order";`);
});

Deno.test("a column or key that is not a plain identifier is refused at generation", () => {
	const Odd = z.object({ slug: z.string(), "Title Case": z.string() });
	const odd = defineEditorialTable<z.infer<typeof Odd>, z.infer<typeof Odd>>({
		table: "editorial.odd",
		key: ["slug"],
		row: Odd,
		toRow: (r) => r,
		fromRow: (r) => r,
	});
	assertThrows(
		() => emitTableSql(editorialContent(odd, [{ slug: "a", "Title Case": "x" }])),
		TypeError,
		"identifier",
	);
	const badKey = defineEditorialTable<z.infer<typeof Odd>, z.infer<typeof Odd>>({
		...odd,
		table: "editorial.odd",
		key: ["Title Case"],
	});
	assertThrows(() => emitTableSql(editorialContent(badKey, [])), TypeError, "identifier");
});

Deno.test("a key-only table does nothing on conflict; an empty one is a comment", () => {
	const Tag = z.object({ slug: z.string() });
	const tags = defineEditorialTable<z.infer<typeof Tag>, { slug: string }>({
		table: "editorial.tags",
		key: ["slug"],
		row: Tag,
		toRow: (t) => t,
		fromRow: (t) => t,
	});
	assertStringIncludes(emitTableSql(editorialContent(tags, [{ slug: "x" }])), "DO NOTHING;");
	assertEquals(emitTableSql(editorialContent(tags, [])), "-- editorial.tags: no rows yet.\n");
});

Deno.test("an invalid record, a duplicate key and a missing key are refused at generation", () => {
	assertThrows(
		() => emitTableSql(editorialContent(articles, [{ slug: "a" } as unknown as Row])),
		RowMapperError,
	);
	const dup = { slug: "a", title: "A", roles: [], body: [] };
	assertThrows(
		() => emitTableSql(editorialContent(articles, [dup, dup])),
		TypeError,
		"duplicate key",
	);
	const keyless = defineEditorialTable<Row, Row>({
		...articles,
		table: "editorial.help_articles",
		key: ["sort"],
	});
	assertThrows(() => emitTableSql(editorialContent(keyless, [dup])), TypeError, "missing");
});

Deno.test("an empty surface emits a header and nothing to run", () => {
	const sql = emitEditorialSeed({
		file: "00005099_seed_editorial_help.sql",
		sourcePath: "packages/backend/services/editorial/content/help.ts",
		source: defineEditorialSurface("help", [editorialContent(articles, [])]),
	});
	assertStringIncludes(sql, "GENERATED. Do not edit by hand.");
	assert(sql.endsWith("\n-- No help content yet.\n"));
	assertEquals(sql.split("\n").filter((l) => l && !l.startsWith("--")), []);
});
// #endregion

// #region Drift
Deno.test("every committed editorial seed migration is exactly what its source emits", () => {
	const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
	for (const target of EDITORIAL_SEEDS) {
		const committed = Deno.readTextFileSync(new URL(target.file, migrations)).replace(
			/\r\n/g,
			"\n",
		);
		assertEquals(
			committed,
			emitEditorialSeed(target),
			`${target.file} is stale — run deno task db:editorial:generate`,
		);
	}
});
// #endregion
