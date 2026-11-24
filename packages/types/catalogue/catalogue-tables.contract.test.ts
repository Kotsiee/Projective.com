/**
 * The catalogue row schemas against the tables that store them (PRD-I3, MARKETPLACE SC1).
 *
 * `catalogue.listings` is read by the seller console as a whole row and parsed at one boundary, so a
 * column added to `00000023_tables_catalogue.sql` without a Zod key, a key with no column, an enum
 * member out of step with its Postgres type, or a derived column the trigger guards but the schema
 * does not name fails here the moment either side is edited, with no database.
 */
import { assert, assertEquals } from "@std/assert";
import type { z } from "zod";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { CreateCategory } from "../org/standing.ts";
import { CatalogueKind, ListingStatus } from "./catalogue.ts";
import {
	type CatalogueListingRow,
	CatalogueListingRowSchema,
	DISCOVERY_LISTING_COLUMNS,
	DiscoveryListingRowSchema,
	LISTING_DERIVED_COLUMNS,
	LISTING_ROW_COLUMNS,
	SCOPED_LISTING_COLUMNS,
	ScopedListingRowSchema,
} from "./rows.ts";
import { SaleRequestRowSchema } from "./sale-requests.ts";

// #region Sources
const TABLES_SQL = readRepoFile("supabase/migrations/00000023_tables_catalogue.sql");
const CORE_ENUMS_SQL = readRepoFile("supabase/migrations/00000003_enums_core.sql");
const DOMAIN_ENUMS_SQL = readRepoFile("supabase/migrations/00000004_enums_domains.sql");
const DERIVED_SQL = readRepoFile("supabase/migrations/00001895_triggers_derived_columns.sql");

/** Each catalogue table with a row schema. */
const ROWS: readonly [table: string, schema: z.ZodObject][] = [
	["catalogue.listings", CatalogueListingRowSchema],
	["catalogue.sale_requests", SaleRequestRowSchema],
];

/** The quoted literals of the first `(...)` list after `anchor` in `sql`. */
function literalsAfter(sql: string, anchor: string): string[] {
	const at = sql.indexOf(anchor);
	assert(at >= 0, `anchor not found: ${anchor}`);
	const open = sql.indexOf("(", at + anchor.length - 1);
	return [...sql.slice(open + 1, sql.indexOf(")", open)).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
// #endregion

// #region Columns
for (const [table, schema] of ROWS) {
	Deno.test(`${table} ⇄ its row schema: zero drift`, () => {
		const drift = columnDrift(tableColumns(TABLES_SQL, table), Object.keys(schema.shape));
		assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
	});
}

Deno.test("a column added to catalogue.listings with no Zod key fails the contract", () => {
	const head = "CREATE TABLE catalogue.listings (";
	assert(TABLES_SQL.includes(head), "CREATE TABLE catalogue.listings not found");
	const widened = TABLES_SQL.replace(head, `${head}\n    added_column text,`);
	const drift = columnDrift(
		tableColumns(widened, "catalogue.listings"),
		Object.keys(CatalogueListingRowSchema.shape),
	);
	assertEquals(drift.missingKeys, ["added_column"]);
});

Deno.test("every listing reader selects table columns, and exactly its schema's keys", () => {
	const columns = new Set(tableColumns(TABLES_SQL, "catalogue.listings"));
	const readers = [
		[CatalogueListingRowSchema, LISTING_ROW_COLUMNS],
		[DiscoveryListingRowSchema, DISCOVERY_LISTING_COLUMNS],
		[ScopedListingRowSchema, SCOPED_LISTING_COLUMNS],
	] as const;
	for (const [schema, select] of readers) {
		const keys = Object.keys(schema.shape);
		assertEquals(select.split(", "), keys);
		assertEquals(keys.filter((key) => !columns.has(key)), []);
	}
});

Deno.test("the derived listing columns are the ones trg_listings_derived guards", () => {
	const trigger = DERIVED_SQL.indexOf("CREATE TRIGGER trg_listings_derived");
	assert(trigger >= 0, "trg_listings_derived not found in 00001895");
	const guarded = literalsAfter(DERIVED_SQL.slice(trigger), "fn_guard_derived_columns(");
	assertEquals([...guarded].sort(), [...LISTING_DERIVED_COLUMNS].sort());
});
// #endregion

// #region Vocabularies
Deno.test("the listing enums are their Postgres enum types, member for member, in order", () => {
	assertEquals(
		literalsAfter(DOMAIN_ENUMS_SQL, "CREATE TYPE catalogue.listing_kind AS ENUM ("),
		[...CatalogueKind.options],
	);
	assertEquals(
		literalsAfter(DOMAIN_ENUMS_SQL, "CREATE TYPE catalogue.listing_status AS ENUM ("),
		[...ListingStatus.options],
	);
	assertEquals(
		literalsAfter(CORE_ENUMS_SQL, "CREATE TYPE org.create_category AS ENUM ("),
		[...CreateCategory.options],
	);
});
// #endregion

// #region Column CHECKs
/** A listing row holding every column's default, as `INSERT` with only the required columns stores it. */
const DEFAULTS: CatalogueListingRow = {
	id: "00000000-0000-4000-8000-0000000c0001",
	owner_user_id: "00000000-0000-4000-8000-0000000000a1",
	owner_team_id: null,
	kind: "service",
	status: "draft",
	service_blueprint_id: "00000000-0000-4000-8000-0000000b0001",
	product_id: null,
	title: "Logo sprint",
	description: {},
	description_text: "",
	category: "",
	delivery_label: "",
	seo_title: null,
	seo_description: null,
	create_category: null,
	amount_cents: 0,
	ticket_price_cents: null,
	session_price_cents: null,
	seats_per_session: null,
	currency: "USD",
	free_revisions: null,
	extra_revision_price_cents: null,
	promoted: false,
	view_count: 0,
	order_count: 0,
	rating_average: 0,
	rating_count: 0,
	published_at: null,
	created_at: "2026-11-18T09:00:00.123456+00:00",
	updated_at: "2026-11-18T09:00:00.123456+00:00",
};

function parses(fields: Record<string, unknown>): boolean {
	return CatalogueListingRowSchema.safeParse({ ...DEFAULTS, ...fields }).success;
}

Deno.test("a row of column defaults parses, and unchanged", () => {
	assertEquals(CatalogueListingRowSchema.parse(DEFAULTS), DEFAULTS);
});

Deno.test("every column CHECK is mirrored at its boundary", () => {
	assertEquals([1, 500].map((n) => parses({ seats_per_session: n })), [true, true]);
	assertEquals([0, 501].map((n) => parses({ seats_per_session: n })), [false, false]);
	assertEquals([0, 99].map((n) => parses({ free_revisions: n })), [true, true]);
	assertEquals([-1, 100].map((n) => parses({ free_revisions: n })), [false, false]);
	assertEquals([0, 5, 4.25].map((n) => parses({ rating_average: n })), [true, true, true]);
	assertEquals([-0.01, 5.01].map((n) => parses({ rating_average: n })), [false, false]);
	assertEquals(parses({ amount_cents: -1 }), false);
	assertEquals(parses({ ticket_price_cents: -1 }), false);
	assertEquals(parses({ view_count: -1 }), false);
	assertEquals(["GBP", "JPY"].map((c) => parses({ currency: c })), [true, true]);
	assertEquals(["usd", "US", "USDT"].map((c) => parses({ currency: c })), [false, false, false]);
	assertEquals(parses({ kind: "bundle" }), false);
	assertEquals(parses({ status: "deleted" }), false);
	assertEquals(parses({ create_category: "invent" }), false);
});

Deno.test("a varchar limit counts characters as Postgres does, not UTF-16 units", () => {
	const astral = "🎨".repeat(70);
	assertEquals(astral.length, 140);
	assertEquals(parses({ seo_title: astral }), true);
	assertEquals(parses({ seo_title: `${astral}x` }), false);
	assertEquals(parses({ seo_description: "a".repeat(160) }), true);
	assertEquals(parses({ seo_description: "a".repeat(161) }), false);
});

Deno.test("a bigint or numeric column sent as a decimal string parses to its number", () => {
	const row = CatalogueListingRowSchema.parse({
		...DEFAULTS,
		amount_cents: "120000",
		rating_average: "4.50",
		ticket_price_cents: "60000",
	});
	assertEquals([row.amount_cents, row.rating_average, row.ticket_price_cents], [
		120_000,
		4.5,
		60_000,
	]);
	assertEquals(parses({ amount_cents: "12.5" }), false);
	assertEquals(parses({ amount_cents: "" }), false);
});
// #endregion
