import { z } from "zod";
import { CreateCategory } from "../org/standing.ts";
import { CatalogueKind, ListingStatus } from "./catalogue.ts";

/**
 * catalogue rows — what the `catalogue` tables STORE, column for column, as PostgREST returns a row.
 *
 * The rest of `@projective/types/catalogue` describes what a surface renders (`ListingSummary`,
 * `ListingDetail`) and what a seller sends (`UpdateListingInput`). This file describes the stored row
 * those are mapped from, keyed by the column names themselves, so the console's select list is the
 * schema's keys and the two cannot drift. `catalogue-tables.contract.test.ts` holds each schema to its
 * `CREATE TABLE` in `00000023_tables_catalogue.sql`, and the derived-column list to the trigger that
 * guards it.
 *
 * Each key carries its column's own CHECK (a range, a length, a pattern), so a row the table would
 * refuse also fails the parse. The two cross-column CHECKs on `catalogue.listings`
 * (`listings_subject_matches_kind`, `listings_published_at_check`) stay the database's: the object
 * stays unrefined so a reader selecting fewer columns can `pick` from it.
 */

// #region Column primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");

/** A `timestamptz` as PostgREST serialises it (an ISO string). */
const timestamptz = z.string();

/**
 * A `bigint` or `numeric` column as PostgREST may send it: a JSON number, or the same value as a
 * decimal string. Either way the parsed row carries a number.
 */
const pgNumber = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]);

/** A `bigint` amount in integer minor units, `CHECK (… >= 0)`. */
const minorUnitsColumn = pgNumber.pipe(z.number().int().min(0));

/** An `integer` counter, `CHECK (… >= 0)`. */
const counterColumn = z.number().int().min(0);

/**
 * A `varchar(n)` value. Postgres counts characters (code points), and a JavaScript string's `length`
 * counts UTF-16 units, so the limit is checked on code points: a 70-character title holding an emoji
 * is a row the table stores, and must parse.
 */
function varchar(n: number) {
	return z.string().refine((s) => [...s].length <= n, `At most ${n} characters.`);
}
// #endregion

// #region catalogue.listings
/**
 * The listing's stored rich body. Every writer stores `{ html }` (`catalogue.save_listing`) or the
 * column default `{}`; keys beyond `html` are not read.
 */
export const ListingDescriptionColumnSchema = z.object({ html: z.string().optional() });

/**
 * One row of `catalogue.listings`, every column. A service listing names its blueprint and a product
 * listing its product (`listings_subject_matches_kind`); a published one carries `published_at`
 * (`listings_published_at_check`).
 */
export const CatalogueListingRowSchema = z.object({
	id: uuid,
	/** The accountable person (→ `org.users_public`). */
	owner_user_id: uuid,
	/** The selling team (→ `org.teams`), or `null` for the person's own listing. */
	owner_team_id: uuid.nullable(),
	/** `catalogue.listing_kind`. */
	kind: CatalogueKind,
	/** `catalogue.listing_status`. */
	status: ListingStatus,
	service_blueprint_id: uuid.nullable(),
	product_id: uuid.nullable(),
	title: z.string(),
	description: ListingDescriptionColumnSchema,
	/** The body flattened to plain text (search, card blurbs). */
	description_text: z.string(),
	category: z.string(),
	/** The turnaround label ("5-day delivery", "60-minute session"). */
	delivery_label: z.string(),
	/** `varchar(70)`; `null` falls back to the title. */
	seo_title: varchar(70).nullable(),
	/** `varchar(160)`; `null` falls back to the plain-text description. */
	seo_description: varchar(160).nullable(),
	/** `org.create_category`; `null` until the seller chooses one. */
	create_category: CreateCategory.nullable(),
	/** The fixed engagement fee. */
	amount_cents: minorUnitsColumn,
	/** A Pipeline's per-ticket standard; `null` is "not priced", never 0. */
	ticket_price_cents: minorUnitsColumn.nullable(),
	/** The per-slot fee; `null` is "not priced". */
	session_price_cents: minorUnitsColumn.nullable(),
	seats_per_session: z.number().int().min(1).max(500).nullable(),
	/** ISO-4217, upper case (`CHECK (currency ~ '^[A-Z]{3}$')`). */
	currency: z.string().regex(/^[A-Z]{3}$/),
	/** `null` = the seller declared nothing; 0 is the stated offer of no rounds. */
	free_revisions: z.number().int().min(0).max(99).nullable(),
	extra_revision_price_cents: minorUnitsColumn.nullable(),
	/** A console hint only; the live state is a `marketplace.promoted_placements` row (Decision #454). */
	promoted: z.boolean(),
	/** Derived: lifetime views. See {@link LISTING_DERIVED_COLUMNS}. */
	view_count: counterColumn,
	/** Derived: completed orders. See {@link LISTING_DERIVED_COLUMNS}. */
	order_count: counterColumn,
	/** Derived: `numeric(3,2)`, 0–5. See {@link LISTING_DERIVED_COLUMNS}. */
	rating_average: pgNumber.pipe(z.number().min(0).max(5)),
	/** Derived: the reviews behind {@link rating_average}. See {@link LISTING_DERIVED_COLUMNS}. */
	rating_count: counterColumn,
	published_at: timestamptz.nullable(),
	created_at: timestamptz,
	updated_at: timestamptz,
});
export type CatalogueListingRow = z.infer<typeof CatalogueListingRowSchema>;

/**
 * The PostgREST select list a whole {@link CatalogueListingRow} is read with: the schema's keys, so
 * the columns read and the columns parsed cannot drift.
 */
export const LISTING_ROW_COLUMNS = Object.keys(CatalogueListingRowSchema.shape).join(", ");

/**
 * The listing columns the platform computes and a client may never write: `trg_listings_derived`
 * (`00001895`) refuses a client write to each, so the seller's own-row UPDATE policy cannot set its
 * own rating or counters. The contract test holds this list to the trigger's arguments.
 */
export const LISTING_DERIVED_COLUMNS = [
	"rating_average",
	"rating_count",
	"view_count",
	"order_count",
] as const satisfies readonly (keyof CatalogueListingRow)[];
// #endregion

// #region Narrower listing reads
/**
 * A listing as discovery reads it (`services/explore/live-catalog.ts`: the published catalogue load,
 * the view page and the owner's preview): what a card or a public page prints, without the rich body,
 * the SEO title, the CREATE category or the derived counters. Picked from
 * {@link CatalogueListingRowSchema}, so every column it reads keeps that column's type and CHECK.
 */
export const DiscoveryListingRowSchema = CatalogueListingRowSchema.pick({
	id: true,
	owner_user_id: true,
	owner_team_id: true,
	kind: true,
	status: true,
	service_blueprint_id: true,
	product_id: true,
	title: true,
	description_text: true,
	category: true,
	delivery_label: true,
	seo_description: true,
	amount_cents: true,
	ticket_price_cents: true,
	session_price_cents: true,
	seats_per_session: true,
	currency: true,
	free_revisions: true,
	extra_revision_price_cents: true,
	promoted: true,
	published_at: true,
	created_at: true,
	updated_at: true,
});
export type DiscoveryListingRow = z.infer<typeof DiscoveryListingRowSchema>;

/** The select list a {@link DiscoveryListingRow} is read with: its schema's keys. */
export const DISCOVERY_LISTING_COLUMNS = Object.keys(DiscoveryListingRowSchema.shape).join(", ");

/**
 * A listing as the console's Analytics and Clients reads scope it (`catalogue/listing-scope.ts`):
 * enough to name it, price it and group it. Picked from {@link CatalogueListingRowSchema}.
 */
export const ScopedListingRowSchema = CatalogueListingRowSchema.pick({
	id: true,
	kind: true,
	title: true,
	currency: true,
	create_category: true,
	service_blueprint_id: true,
	product_id: true,
});
export type ScopedListingRow = z.infer<typeof ScopedListingRowSchema>;

/** The select list a {@link ScopedListingRow} is read with: its schema's keys. */
export const SCOPED_LISTING_COLUMNS = Object.keys(ScopedListingRowSchema.shape).join(", ");
// #endregion
