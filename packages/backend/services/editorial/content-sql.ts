import type { RowMapperMeta } from "../../core/row-mapper.ts";
import type { AnyEditorialContent, EditorialSurfaceSource } from "./editorial-source.ts";

/**
 * content-sql.ts — emit one editorial surface's content source as its category-5 seed migration
 * (Decision #274). Pure and synchronous: `scripts/editorial-generate.ts` writes what this returns, and
 * `content-sql.test.ts` re-emits every surface and fails while a committed file disagrees with its
 * source — so the jsonb in those files is never edited by hand.
 *
 * Every record goes through its table's `toRow` and row schema first (`rowsFromRecords`), the same
 * steps the fixture path takes, so a record the generator accepts is one the reader can serve.
 *
 * ## What a value becomes
 *
 * | Value                         | SQL                                                          |
 * | :---------------------------- | :----------------------------------------------------------- |
 * | `null`                        | `NULL`                                                       |
 * | absent / `undefined`          | `DEFAULT` (the column's own default)                         |
 * | string · number · boolean     | a literal, `::cast` appended when the table declares one     |
 * | array, cast ending in `[]`    | `ARRAY[…]::cast` (`'{}'::cast` when empty)                   |
 * | any other array, or an object | `'<json>'::jsonb` (or the declared cast)                     |
 *
 * NUL is refused anywhere — in text, and in any string or key inside a jsonb value (Postgres
 * rejects `\u0000` in jsonb) — so a bad record fails generation, not a reset.
 *
 * Each table becomes one multi-row `INSERT … ON CONFLICT (<key>) DO UPDATE SET <every other column>`,
 * so re-running a file is a no-op and a regenerated file updates the rows it wrote before. Column
 * names (the row schema's keys) must be plain lowercase identifiers and are emitted double-quoted,
 * so a column may be named `order` or `default`; the schema-qualified table name is validated by
 * `defineRowMapper` and needs no quoting.
 *
 * **Nothing is pruned.** A record removed from its source (or whose key changes) leaves its old row
 * in any database that is not rebuilt; the removal takes effect only on the next reset. So content
 * is never retracted by deleting its record: give the table a visibility column, author the record
 * hidden, and let the table's `visible` predicate (`defineEditorialTable`) and SELECT policy hide it
 * — which is also the platform rule that nothing is hard-deleted.
 */

// #region Literals
/** A single-quoted SQL string literal. Refuses NUL, which a Postgres text value cannot hold. */
function quote(text: string): string {
	if (text.includes("\0")) throw new TypeError("A SQL text value cannot contain a NUL character.");
	return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Whether any string or key inside a JSON-bound value holds NUL. `JSON.stringify` writes it as the
 * six characters `\u0000`, which pass {@link quote} but which Postgres refuses in jsonb; a literal
 * backslash followed by `u0000` in a string is fine, so this inspects the values, not the JSON text.
 */
function holdsNul(value: unknown): boolean {
	if (typeof value === "string") return value.includes("\0");
	if (Array.isArray(value)) return value.some(holdsNul);
	if (value !== null && typeof value === "object") {
		const json = value as { toJSON?: () => unknown };
		if (typeof json.toJSON === "function") return holdsNul(json.toJSON());
		return Object.entries(value).some(([key, inner]) => key.includes("\0") || holdsNul(inner));
	}
	return false;
}

/** A plain lowercase SQL identifier — what a column or key name must be. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** A validated, double-quoted column name (`order` → `"order"`). */
export function sqlIdentifier(name: string): string {
	if (!IDENTIFIER.test(name)) {
		throw new TypeError(`"${name}" is not a plain lowercase SQL identifier ([a-z_][a-z0-9_]*).`);
	}
	return `"${name}"`;
}

/** Append `::cast` when one is declared. */
function withCast(literal: string, cast: string | undefined): string {
	return cast ? `${literal}::${cast}` : literal;
}

/** One scalar inside an `ARRAY[…]` literal. */
function element(value: unknown): string {
	if (value === null) return "NULL";
	if (typeof value === "string") return quote(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	throw new TypeError(`An array column holds scalars only, got ${JSON.stringify(value)}.`);
}

/**
 * The SQL literal for one column value (see the module table). `undefined` yields `DEFAULT`, which is
 * only valid inside an INSERT's VALUES list — the one place this emitter writes values.
 */
export function sqlValue(value: unknown, cast?: string): string {
	if (value === undefined) return "DEFAULT";
	if (value === null) return "NULL";
	if (typeof value === "string") return withCast(quote(value), cast);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`A SQL number must be finite, got ${value}.`);
		return withCast(String(value), cast);
	}
	if (typeof value === "bigint") return withCast(String(value), cast);
	if (typeof value === "boolean") return withCast(value ? "true" : "false", cast);
	if (value instanceof Date) return withCast(quote(value.toISOString()), cast ?? "timestamptz");
	if (Array.isArray(value) && cast?.endsWith("[]")) {
		return value.length ? `ARRAY[${value.map(element).join(", ")}]::${cast}` : `'{}'::${cast}`;
	}
	if (typeof value === "object") {
		if (holdsNul(value)) throw new TypeError("A jsonb value cannot contain a NUL character.");
		return withCast(quote(JSON.stringify(value)), cast ?? "jsonb");
	}
	throw new TypeError(`No SQL literal for a ${typeof value} value.`);
}
// #endregion

// #region Statements
/** The column list: every key any row carries, in first-appearance order. */
function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
	const columns: string[] = [];
	for (const row of rows) {
		for (const column of Object.keys(row)) if (!columns.includes(column)) columns.push(column);
	}
	return columns;
}

/** Refuse a row with no natural key, and two rows with the same one (one INSERT cannot upsert both). */
function assertKeys(table: RowMapperMeta, rows: readonly Record<string, unknown>[]): void {
	const seen = new Set<string>();
	rows.forEach((row, i) => {
		const values = table.key.map((column) => row[column]);
		if (values.some((v) => v === undefined || v === null)) {
			throw new TypeError(`${table.table} row ${i}: the key (${table.key.join(", ")}) is missing.`);
		}
		const id = JSON.stringify(values);
		if (seen.has(id)) throw new TypeError(`${table.table} row ${i}: duplicate key ${id}.`);
		seen.add(id);
	});
}

/** One table's upsert, or a comment when it has no records yet. */
export function emitTableSql(content: AnyEditorialContent): string {
	const { table } = content;
	const keys = table.key.map(sqlIdentifier).join(", ");
	const rows = content.rows();
	if (rows.length === 0) return `-- ${table.table}: no rows yet.\n`;
	assertKeys(table, rows);

	const columns = columnsOf(rows);
	const names = new Map(columns.map((column) => [column, sqlIdentifier(column)]));
	const values = rows.map((row) =>
		`    (${columns.map((column) => sqlValue(row[column], table.casts[column])).join(", ")})`
	);
	const updates = columns.filter((column) => !table.key.includes(column));
	const conflict = updates.length
		? `ON CONFLICT (${keys}) DO UPDATE SET\n${
			updates.map((column) => `    ${names.get(column)} = EXCLUDED.${names.get(column)}`).join(
				",\n",
			)
		};`
		: `ON CONFLICT (${keys}) DO NOTHING;`;

	return [
		`-- #region ${table.table} (${rows.length} ${rows.length === 1 ? "row" : "rows"})`,
		`INSERT INTO ${table.table} (${columns.map((column) => names.get(column)).join(", ")})`,
		"VALUES",
		values.join(",\n"),
		conflict,
		"-- #endregion",
		"",
	].join("\n");
}

/** Where a surface's seed migration lives and what it is generated from. */
export interface EditorialSeedTarget {
	/** The migration file name, e.g. `00005071_seed_editorial_help.sql`. */
	readonly file: string;
	/** Repo-relative path of the content source, named in the file's header. */
	readonly sourcePath: string;
	/** The content source itself. */
	readonly source: EditorialSurfaceSource;
}

/** The whole seed migration for one surface: a header, then each table in declared order. */
export function emitEditorialSeed(target: EditorialSeedTarget): string {
	const { surface, tables } = target.source;
	const rule = `-- ${"=".repeat(93)}`;
	const header = [
		rule,
		`-- ${target.file} — GENERATED. Do not edit by hand.`,
		"--",
		`-- The \`${surface}\` surface's editorial content (Category 5, Decision #274), emitted by`,
		`-- \`deno task db:editorial:generate\` from ${target.sourcePath}.`,
		"-- Edit that source and re-run the task: content-sql.test.ts fails while this file and its source",
		"-- disagree. Every row is upserted on its natural key, so re-running this file changes nothing.",
		rule,
		"",
	].join("\n");
	const total = tables.reduce((n, content) => n + content.records.length, 0);
	if (total === 0) return `${header}\n-- No ${surface} content yet.\n`;
	return `${header}\n${tables.map(emitTableSql).join("\n\n")}`;
}
// #endregion
