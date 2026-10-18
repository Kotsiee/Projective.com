import type { z } from "zod";

/**
 * row-mapper.ts — the one typed seam between a table's ROW and the DOMAIN record a service hands out.
 *
 * A row is the JSON PostgREST returns for one table row, and its Zod schema is that table's SSOT in
 * `@projective/types`. A domain record is what a service and its route speak (camelCase, nested,
 * derived). A mapper declares both directions once:
 *
 *  - `fromRow` — database → service. The live read path parses every row it receives and maps it.
 *  - `toRow`   — authored record → database. A content source (editorial) or a fixture (community)
 *    is authored as domain records and pushed through `toRow` and the SAME row parse before it is
 *    either emitted as seed SQL or served in fixture mode.
 *
 * That is the whole point: a fixture path that skipped the row schema could serve a record the
 * database would refuse, and a live path that mapped rows differently could render the same content
 * differently. With one mapper, `recordsFromRows(m, rowsFromRecords(m, authored))` is exactly what a
 * live read of the seeded table returns, so the fixture and the database cannot drift.
 *
 * Pure and synchronous: no Supabase, no environment. The schema-specific modules
 * (`services/editorial/editorial-source.ts`, `services/community/community-source.ts`) add the gate
 * and the client on top.
 */

// #region Types
/** What a table declares once (see the module docblock). */
export interface RowMapperSpec<Row extends Record<string, unknown>, Domain> {
	/** Schema-qualified table name, e.g. `editorial.help_articles`. */
	table: `${string}.${string}`;
	/**
	 * The natural key: the columns the generated seed upserts on (`ON CONFLICT (…)`), which must be a
	 * PRIMARY KEY or UNIQUE constraint of the table. A content row is addressed by its slug or
	 * version, never by a random id, so a regenerated seed updates the row it wrote last time.
	 */
	key: readonly (keyof Row & string)[];
	/** The row's Zod schema — the PostgREST JSON shape, from `@projective/types`. */
	row: z.ZodType<Row>;
	/**
	 * Explicit Postgres casts for columns whose type a value cannot reveal: an enum (`"x"::my.enum`),
	 * a `text[]` or enum array (an array is otherwise emitted as `jsonb`), a `date` or `timestamptz`.
	 */
	casts?: Readonly<Partial<Record<keyof Row & string, string>>>;
	/** Authored record → row. */
	toRow(record: Domain): Row;
	/** Row → domain record. */
	fromRow(row: Row): Domain;
}

/**
 * The part of a declared table that does not depend on its row type — what a collection of several
 * tables (a surface's content source, the seed generator) can hold without erasing types to `any`.
 */
export interface RowMapperMeta {
	/** Schema-qualified table name. */
	readonly table: `${string}.${string}`;
	/** The schema half of {@link RowMapperMeta.table} — what `.schema()` takes. */
	readonly schema: string;
	/** The table half of {@link RowMapperMeta.table} — what `.from()` takes. */
	readonly name: string;
	/** See {@link RowMapperSpec.key}. */
	readonly key: readonly string[];
	/** See {@link RowMapperSpec.casts}; `{}` when none were declared. */
	readonly casts: Readonly<Record<string, string | undefined>>;
}

/** A declared table: its spec, with the schema and bare table name split out. */
export interface RowMapper<Row extends Record<string, unknown>, Domain> extends RowMapperMeta {
	/** See {@link RowMapperSpec.key}. */
	readonly key: readonly (keyof Row & string)[];
	/** See {@link RowMapperSpec.row}. */
	readonly row: z.ZodType<Row>;
	/** Authored record → row. */
	toRow(record: Domain): Row;
	/** Row → domain record. */
	fromRow(row: Row): Domain;
}

/** A row that failed its table's schema — which table, which position, and why. */
export class RowMapperError extends Error {
	constructor(
		readonly table: string,
		readonly index: number,
		readonly issues: string,
	) {
		super(`${table} row ${index}: ${issues}`);
		this.name = "RowMapperError";
	}
}
// #endregion

// #region Declaring and mapping
/**
 * Declare a table's mapper. Validates the declaration itself — a qualified name and a non-empty key
 * — so a typo fails when the module loads rather than as an `ON CONFLICT` error at reset time.
 */
export function defineRowMapper<Row extends Record<string, unknown>, Domain>(
	spec: RowMapperSpec<Row, Domain>,
): RowMapper<Row, Domain> {
	const match = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(spec.table);
	if (!match) {
		throw new TypeError(`A row mapper needs a schema-qualified table, got "${spec.table}".`);
	}
	if (spec.key.length === 0) {
		throw new TypeError(`${spec.table}: a row mapper needs a natural key.`);
	}
	const casts: Readonly<Record<string, string | undefined>> = { ...spec.casts };
	const mapper: RowMapper<Row, Domain> = {
		table: spec.table,
		schema: match[1],
		name: match[2],
		key: spec.key,
		row: spec.row,
		casts,
		toRow: (record: Domain) => spec.toRow(record),
		fromRow: (row: Row) => spec.fromRow(row),
	};
	return Object.freeze(mapper);
}

/** Parse one raw value against the table's row schema, or throw a {@link RowMapperError}. */
export function parseRow<Row extends Record<string, unknown>, Domain>(
	mapper: RowMapper<Row, Domain>,
	raw: unknown,
	index = 0,
): Row {
	const parsed = mapper.row.safeParse(raw);
	if (parsed.success) return parsed.data;
	const issues = parsed.error.issues
		.map((issue) => `${issue.path.join(".") || "(row)"}: ${issue.message}`)
		.join("; ");
	throw new RowMapperError(mapper.table, index, issues);
}

/** Authored records → validated rows (`toRow`, then the row parse). The generator's input. */
export function rowsFromRecords<Row extends Record<string, unknown>, Domain>(
	mapper: RowMapper<Row, Domain>,
	records: readonly Domain[],
): Row[] {
	return records.map((record, i) => parseRow(mapper, mapper.toRow(record), i));
}

/** Raw rows (from PostgREST, or from {@link rowsFromRecords}) → domain records. */
export function recordsFromRows<Row extends Record<string, unknown>, Domain>(
	mapper: RowMapper<Row, Domain>,
	rows: readonly unknown[],
): Domain[] {
	return rows.map((raw, i) => mapper.fromRow(parseRow(mapper, raw, i)));
}
// #endregion
