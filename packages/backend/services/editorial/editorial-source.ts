import type { SupabaseClient } from "supabaseClient";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, isEditorialBackendLive } from "../../core/supabase.ts";
import {
	defineRowMapper,
	recordsFromRows,
	type RowMapper,
	RowMapperError,
	type RowMapperMeta,
	type RowMapperSpec,
	rowsFromRecords,
} from "../../core/row-mapper.ts";

/**
 * editorial-source.ts — the one shared module every editorial surface service reuses (Decision #274):
 * the gate, the live-or-fixture read, and the typed table declaration the content sources and the
 * seed generator are built on.
 *
 * ## The model
 *
 * Editorial content (the help centre, the changelog, Projective's articles) is platform reference
 * data. It is authored ONCE, as domain records in `content/<surface>.ts`, and those records reach the
 * reader by one of two roads that share every step after the authoring:
 *
 *   database — `deno task db:editorial:generate` pushes each record through `toRow` and the row's Zod
 *              schema and emits the rows as a category-5 migration — EVERY record, hidden ones
 *              included; the live read selects them back through the anon client and maps every row
 *              with the same row schema and `fromRow`.
 *   fixture  — with `EDITORIAL_BACKEND_LIVE` off, {@link readEditorialTable} pushes the same records
 *              through the same `toRow`, row parse and `fromRow`, in memory.
 *
 * So the fixture path is not a second copy of the content that can drift: it is the database's own
 * input, served without the database.
 *
 * ## Visibility — one rule, applied on both roads
 *
 * A record a reader must not see yet (a draft, a release dated in the future, a retracted article) is
 * hidden by its table's `visible` predicate ({@link defineEditorialTable}), which
 * {@link readEditorialTable} applies to the MAPPED records on both roads, at the same `now`. It is the
 * authority for what a service serves. The table's SELECT policy expresses the same predicate in SQL,
 * so a direct PostgREST read is closed too, and is never NARROWER than it (a row the predicate shows
 * but the policy hides would be served by the fixture road and missing live). A table where nothing
 * is ever hidden declares no `visible` and a `USING (true)` policy. Content is retracted by authoring
 * the record hidden, never by deleting it: the generated seed upserts and never prunes.
 *
 * ## Rules for a surface's tables
 *
 *  - Key every table by a natural key (a slug, a semver version) — the generated seed upserts on it.
 *  - Author every column the reader needs. A column the database fills (a random id, `now()`) does
 *    not exist in fixture mode, so the two roads would disagree; if a table must have one, make it
 *    optional in the row schema and never read it.
 *  - Neither road promises an order: sort the mapped records in the service. Read whole tables and
 *    filter the records in TypeScript — editorial tables are small reference sets (well under
 *    PostgREST's `max_rows`), and one code path for both roads is worth more than a narrower query.
 *  - Bodies are ContentNode JSON (`@projective/types/content`), validated by the row schema.
 */

// #region Surfaces
/** The editorial surfaces, one content source and one generated seed migration each. */
export const EDITORIAL_SURFACES = ["help", "changelog", "articles"] as const;

/** One editorial surface. */
export type EditorialSurface = (typeof EDITORIAL_SURFACES)[number];

/** Where an editorial read was answered from. */
export type EditorialSource = "live" | "fixture";

export { isEditorialBackendLive };

/** The road an editorial read takes in this environment. */
export function editorialSource(): EditorialSource {
	return isEditorialBackendLive() ? "live" : "fixture";
}
// #endregion

// #region Tables and content sources
/**
 * Whether a reader may see `record` at `now` (see "Visibility" in the module docblock). Pure: the
 * same record and instant answer the same on both roads.
 */
export type EditorialVisibility<Domain> = (record: Domain, now: Date) => boolean;

/** A table in the `editorial` schema, declared once for the generator, the reader and the fixtures. */
export type EditorialTable<Row extends Record<string, unknown>, Domain> =
	& RowMapper<Row, Domain>
	& {
		/** The table's visibility predicate; absent when every record is always visible. */
		readonly visible?: EditorialVisibility<Domain>;
	};

/** What {@link defineEditorialTable} takes: a row mapper's spec, in `editorial`, plus `visible`. */
export type EditorialTableSpec<Row extends Record<string, unknown>, Domain> =
	& RowMapperSpec<Row, Domain>
	& {
		table: `editorial.${string}`;
		/**
		 * Hide a record from readers (a draft, a future-dated release, a retraction). Applied by
		 * {@link readEditorialTable} on both roads; the table's SELECT policy states the same rule.
		 * The generator ignores it — hidden records are seeded like any other.
		 */
		visible?: EditorialVisibility<Domain>;
	};

/**
 * Declare an editorial table. Refuses a table outside the `editorial` schema, so a content source
 * cannot emit seed rows into another domain's tables.
 */
export function defineEditorialTable<Row extends Record<string, unknown>, Domain>(
	spec: EditorialTableSpec<Row, Domain>,
): EditorialTable<Row, Domain> {
	if (!spec.table.startsWith("editorial.")) {
		throw new TypeError(`An editorial table lives in the editorial schema, got "${spec.table}".`);
	}
	const visible = spec.visible;
	return Object.freeze({ ...defineRowMapper(spec), visible });
}

/** One table's authored records, paired with the table that validates them. */
export interface EditorialContent<Row extends Record<string, unknown>, Domain>
	extends AnyEditorialContent {
	readonly table: EditorialTable<Row, Domain>;
	readonly records: readonly Domain[];
	/** The records as validated rows — `toRow`, then the row parse (throws `RowMapperError`). */
	rows(): Row[];
}

/**
 * {@link EditorialContent} without its row and record types, for a surface's list of tables and the
 * generator: the table's metadata plus a thunk that validates and returns its rows.
 */
export interface AnyEditorialContent {
	readonly table: RowMapperMeta;
	readonly records: readonly unknown[];
	rows(): Record<string, unknown>[];
}

/** Pair a table with its authored records (typed: a record must be the table's domain shape). */
export function editorialContent<Row extends Record<string, unknown>, Domain>(
	table: EditorialTable<Row, Domain>,
	records: readonly Domain[],
): EditorialContent<Row, Domain> {
	return Object.freeze({ table, records, rows: () => rowsFromRecords(table, records) });
}

/**
 * A surface's whole content source: its tables in DEPENDENCY order (a category before the articles
 * that reference it), which is the order the generator emits them in.
 */
export interface EditorialSurfaceSource {
	readonly surface: EditorialSurface;
	readonly tables: readonly AnyEditorialContent[];
}

/** Declare a surface's content source. Refuses a table listed twice. */
export function defineEditorialSurface(
	surface: EditorialSurface,
	tables: readonly AnyEditorialContent[],
): EditorialSurfaceSource {
	const seen = new Set<string>();
	for (const content of tables) {
		if (seen.has(content.table.table)) {
			throw new TypeError(`${surface}: ${content.table.table} is listed twice.`);
		}
		seen.add(content.table.table);
	}
	return Object.freeze({ surface, tables: Object.freeze([...tables]) });
}
// #endregion

// #region Reading
/** How long one live read of an editorial table is served before it is read again. */
export const EDITORIAL_CACHE_TTL_MS = 5 * 60_000;

/**
 * Live reads by table, mapped but NOT yet filtered: visibility is asked at each caller's `now`, so a
 * release dated an hour ahead still appears on time from a cached read. Editorial rows change only
 * by migration, so expiry is the only invalidation they need.
 */
const liveCache = new Map<string, { at: number; records: unknown[] }>();

/** What {@link readEditorialTable} answers: the mapped records and the road they came by. */
export interface EditorialRead<Domain> {
	records: Domain[];
	source: EditorialSource;
}

/** Overrides for {@link readEditorialTable} — tests inject them; services pass none. */
export interface EditorialReadOptions {
	/** Force a road instead of reading the gate. */
	source?: EditorialSource;
	/** The client the live read runs as. Defaults to the anon client: editorial is public content. */
	client?: SupabaseClient;
	/** The instant the table's `visible` predicate is asked at. Defaults to now. */
	now?: Date;
}

/**
 * Read one editorial table's records by the road this environment takes (see the module docblock),
 * keeping only those the table's `visible` predicate shows at `now` — on both roads alike. A live
 * read through the default client is cached for {@link EDITORIAL_CACHE_TTL_MS}; an injected client
 * (a test) always reads fresh.
 *
 * Failures are answers, not throws: an unreachable or unexposed schema is a 503 (PostgREST answers
 * `PGRST106` until `editorial` is in `supabase/config.toml` and the stack restarted), and a row that
 * fails its schema — a drifted table or a bad content record — is a 500 naming the table and row.
 */
export async function readEditorialTable<Row extends Record<string, unknown>, Domain>(
	content: EditorialContent<Row, Domain>,
	options: EditorialReadOptions = {},
): Promise<ServiceResult<EditorialRead<Domain>>> {
	const source = options.source ?? editorialSource();
	const { table } = content;
	const now = options.now ?? new Date();
	const { visible } = table;
	const shown = (records: Domain[]): Domain[] =>
		visible ? records.filter((record) => visible(record, now)) : [...records];
	try {
		if (source === "fixture") {
			return ok({ records: shown(recordsFromRows(table, content.rows())), source });
		}
		const cacheable = options.client === undefined;
		const hit = cacheable ? liveCache.get(table.table) : undefined;
		if (hit && Date.now() - hit.at < EDITORIAL_CACHE_TTL_MS) {
			return ok({ records: shown(hit.records as Domain[]), source });
		}
		const client = options.client ?? getAnonClient();
		const { data, error } = await client.schema(table.schema).from(table.name).select("*");
		if (error) {
			return fail(503, {
				message: "This content is unavailable right now. Please try again shortly.",
				details: { table: table.table, code: error.code ?? null },
			});
		}
		const records = recordsFromRows(table, data ?? []);
		if (cacheable) liveCache.set(table.table, { at: Date.now(), records });
		return ok({ records: shown(records), source });
	} catch (err) {
		if (err instanceof RowMapperError) {
			return fail(500, {
				message: "This content could not be read.",
				details: { table: err.table, row: err.index, issues: err.issues },
			});
		}
		throw err;
	}
}
// #endregion
