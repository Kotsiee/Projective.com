import type { z } from "zod";

/**
 * listing-rows — checking a `catalogue.listings` row read from PostgREST against its row schema
 * (`CatalogueListingRowSchema`, or a reader's `pick` of it, in `@projective/types/catalogue`).
 *
 * Every reader of the table parses at its own read boundary, and the readers differ only in what they
 * do with a row the schema refuses. The seller's console throws (`parseListingRowWith`): the read
 * answers for one seller, who should see the failure. Discovery drops the row and warns
 * (`checkListingRow`): one seller's malformed row must not take every other seller's storefront down.
 */

// #region Check
/** A parsed row, or the message naming the listing and each column its schema refused. */
export type ListingRowCheck<T> = { ok: true; row: T } | { ok: false; message: string };

/** `row` parsed by `schema`, never throwing. */
export function checkListingRow<S extends z.ZodType>(
	schema: S,
	row: unknown,
): ListingRowCheck<z.output<S>> {
	const parsed = schema.safeParse(row);
	if (parsed.success) return { ok: true, row: parsed.data };
	const id = (row as { id?: unknown } | null)?.id;
	const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`);
	return {
		ok: false,
		message: `catalogue.listings row ${
			typeof id === "string" ? id : "?"
		} does not match its schema — ${issues.join("; ")}`,
	};
}

/** `row` parsed by `schema`, or an `Error` naming the listing and each column refused. */
export function parseListingRowWith<S extends z.ZodType>(schema: S, row: unknown): z.output<S> {
	const checked = checkListingRow(schema, row);
	if (checked.ok) return checked.row;
	throw new Error(checked.message);
}
// #endregion
