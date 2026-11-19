/**
 * `scripts/release-guard.ts` (OPS6 step 3, Decision #512) on its two committed fixtures and on one
 * small delta per pattern. No network: `run` reads only the in-memory files the harness hands it.
 * Pins what the Additive Rule refuses, what it lets through, the approval line and the exit codes.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
	findApprovals,
	type GuardRule,
	indexedDecisions,
	run,
	scanDelta,
	stripComments,
} from "./release-guard.ts";

// #region Harness
const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));
const DROP_FIXTURE = await read("./release-guard.drop.fixture.sql");
const APPROVED_FIXTURE = await read("./release-guard.approved.fixture.sql");
const INDEX = "- **#203** Scheduled work.\n- **#512** OPS6 release guard.\n";

async function guard(
	files: Record<string, string>,
	args = Object.keys(files),
): Promise<{ code: number; out: string }> {
	const lines: string[] = [];
	const all: Record<string, string> = { "index.md": INDEX, ...files };
	const code = await run({
		args: [...args, "--decisions", "index.md"],
		readText: (path) =>
			path in all ? Promise.resolve(all[path]) : Promise.reject(new Deno.errors.NotFound(path)),
		print: (line) => lines.push(line),
	});
	return { code, out: lines.join("\n") };
}

const rules = (sql: string): GuardRule[] => scanDelta(sql).map((finding) => finding.rule);
// #endregion

// #region The committed fixtures
Deno.test("release:guard — the DROP fixture is refused", async () => {
	const { code, out } = await guard({ "drop.sql": DROP_FIXTURE });
	assertEquals(code, 1, out);
	assertStringIncludes(out, "✗ drop-table");
	assertStringIncludes(out, "✗ drop-column");
	assertStringIncludes(out, "✗ drop-fk");
	assertStringIncludes(out, "✗ protected");
	assertStringIncludes(out, "is refused");
});

Deno.test("release:guard — the same statements with an approval line are accepted", async () => {
	assertEquals(rules(APPROVED_FIXTURE), rules(DROP_FIXTURE));
	const { code, out } = await guard({ "approved.sql": APPROVED_FIXTURE });
	assertEquals(code, 0, out);
	assertStringIncludes(out, "is approved by Decision #512");
});

Deno.test("release:guard — the real decision index holds the fixture's decision", async () => {
	const index = (await read("../documentation/reference/decisions/README.md")).replaceAll("\r", "");
	const [approval] = findApprovals(APPROVED_FIXTURE).approvals;
	assert(indexedDecisions(index).has(approval.decision));
});
// #endregion

// #region What it refuses
Deno.test("refuses — every destructive shape, qualified, quoted or bare", () => {
	assertEquals(rules("DROP TABLE IF EXISTS catalogue.listings CASCADE;"), ["drop-table"]);
	assertEquals(rules("drop schema legacy cascade;"), ["drop-table"]);
	assertEquals(rules("ALTER TABLE org.users RENAME TO members;"), ["drop-table"]);
	assertEquals(rules("ALTER TABLE ONLY org.users DROP COLUMN bio;"), ["drop-column"]);
	assertEquals(rules('ALTER TABLE "org"."users" DROP IF EXISTS headline;'), ["drop-column"]);
	assertEquals(rules("ALTER TABLE org.users RENAME COLUMN bio TO about;"), ["drop-column"]);
	assertEquals(rules("ALTER TABLE org.users RENAME bio TO about;"), ["drop-column"]);
	assertEquals(rules("ALTER TABLE projects.tickets DROP CONSTRAINT tickets_stage_id_fkey;"), [
		"drop-fk",
	]);
});

Deno.test("refuses — any change at all to a protected table, ADD COLUMN included", () => {
	assertEquals(rules("ALTER TABLE finance.escrows ADD COLUMN note text;"), ["protected"]);
	assertEquals(
		rules('ALTER TABLE IF EXISTS "finance"."wallets" ALTER COLUMN currency SET DEFAULT \'GBP\';'),
		[
			"protected",
		],
	);
	assertEquals(rules("alter table projects.project_stages drop column title;"), [
		"drop-column",
		"protected",
	]);
	assertEquals(rules("DROP TABLE finance.wallets;"), ["drop-table", "protected"]);
	assertEquals(rules("ALTER TABLE project_stages ENABLE ROW LEVEL SECURITY;"), ["protected"]);
});

Deno.test("refuses — a destructive statement a DO block executes", () => {
	assertEquals(rules("DO $$ BEGIN EXECUTE 'DROP TABLE org.users'; END $$;"), ["drop-table"]);
});
// #endregion

// #region What it lets through
Deno.test("lets through — additive changes and column alterations that drop nothing", () => {
	const additive = [
		"CREATE TABLE ops.release_notes (id uuid PRIMARY KEY);",
		"ALTER TABLE org.users ADD COLUMN pronouns text;",
		"ALTER TABLE org.users ALTER COLUMN bio DROP NOT NULL;",
		"ALTER TABLE org.users ALTER COLUMN bio DROP DEFAULT;",
		"ALTER TABLE projects.tickets ADD CONSTRAINT tickets_stage_fk FOREIGN KEY (stage_id) REFERENCES projects.project_stages (id);",
		"CREATE INDEX ON finance.escrows (status);",
		"DROP VIEW IF EXISTS finance.v_wallet_summary;",
		"DROP FUNCTION IF EXISTS ops.fn_old();",
		"ALTER TABLE finance.escrows_archive ADD COLUMN note text;",
		"ALTER TABLE org.users ALTER COLUMN bio  DROP  NOT NULL;",
	].join("\n");
	assertEquals(scanDelta(additive), []);
});

Deno.test("errs on the safe side — the words inside a string literal count", () => {
	assertEquals(rules("COMMENT ON TABLE org.users IS 'never DROP TABLE this';"), ["drop-table"]);
});

Deno.test("lets through — commented-out statements, and a -- inside a string is not a comment", () => {
	assertEquals(
		rules("-- DROP TABLE org.users;\n/* ALTER TABLE finance.escrows DROP COLUMN x; */ SELECT 1;"),
		[],
	);
	assertEquals(rules("SELECT '--'; DROP TABLE org.users;"), ["drop-table"]);
	assertEquals(stripComments("a -- b\nc").length, "a -- b\nc".length);
});
// #endregion

// #region The approval line and the CLI
Deno.test("approval — a malformed line, or one naming a decision the index lacks, is refused", async () => {
	const drop = "DROP TABLE org.users;\n";
	const malformed = await guard({ "a.sql": `-- additive-rule-approved: yes please\n${drop}` });
	assertEquals(malformed.code, 1);
	assertStringIncludes(malformed.out, "✗ approval");
	const unknown = await guard({
		"b.sql": `-- additive-rule-approved: Decision #9999 by A. Person on 2026-11-19\n${drop}`,
	});
	assertEquals(unknown.code, 1);
	assertStringIncludes(unknown.out, "which the decision index does not hold");
	const lowercase = await guard({
		"c.sql": `-- ADDITIVE-RULE-APPROVED: decision #203 by A. Person on 2026-11-19\n${drop}`,
	});
	assertEquals(lowercase.code, 0, lowercase.out);
});

Deno.test("cli — a clean delta passes, several files are judged together, bad input cannot run", async () => {
	const clean = await guard({ "clean.sql": "ALTER TABLE org.users ADD COLUMN pronouns text;" });
	assertEquals(clean.code, 0);
	assertStringIncludes(clean.out, "is additive");
	assertEquals((await guard({ "clean.sql": "SELECT 1;", "drop.sql": DROP_FIXTURE })).code, 1);
	assertEquals((await guard({})).code, 2);
	assertEquals((await guard({}, ["missing.sql"])).code, 2);
	assertEquals((await guard({ "x.sql": "SELECT 1;" }, ["x.sql", "--bogus"])).code, 2);
	const lines: string[] = [];
	const noIndex = await run({
		args: ["x.sql", "--decisions", "nowhere.md"],
		readText: (path) =>
			path === "x.sql"
				? Promise.resolve("SELECT 1;")
				: Promise.reject(new Deno.errors.NotFound(path)),
		print: (line) => lines.push(line),
	});
	assertEquals(noIndex, 2);
});

Deno.test("findings carry the statement's line", () => {
	const [finding] = scanDelta("SELECT 1;\n\n  ALTER TABLE org.users\n    DROP COLUMN bio;");
	assertEquals(finding.line, 3);
	assertEquals(finding.statement, "ALTER TABLE org.users DROP COLUMN bio");
});
// #endregion
