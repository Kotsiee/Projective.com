import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { CatalogueListingRowSchema } from "@projective/types/catalogue";
import { FIXTURE_LISTINGS } from "./catalogue-fixtures.ts";
import { stubCatalogueClient } from "./catalogue-stub-client.ts";
import { LISTING_COLUMNS, listingBySlug, parseListingRow } from "./live-catalogue.ts";

/**
 * The console's one `catalogue.listings` read boundary: every row the seller's reads select is parsed
 * by `CatalogueListingRowSchema` before anything maps it (PRD-I3, MARKETPLACE SC1).
 */

// #region Boundary
const PIPELINE = FIXTURE_LISTINGS[0];

Deno.test("the console selects every column the row schema names, and nothing else", () => {
	assertEquals(LISTING_COLUMNS.split(", "), Object.keys(CatalogueListingRowSchema.shape));
});

Deno.test("every fixture listing is a whole row, and parses unchanged", () => {
	for (const { listing } of FIXTURE_LISTINGS) assertEquals(parseListingRow(listing), listing);
});

Deno.test("a row read with the old 27-column select is refused, naming what it lacks", () => {
	const { order_count: _o, rating_average: _a, rating_count: _c, ...partial } = PIPELINE.listing;
	const error = assertThrows(() => parseListingRow(partial), Error);
	for (const column of ["order_count", "rating_average", "rating_count"]) {
		assertEquals(error.message.includes(`${column}:`), true, column);
	}
	assertEquals(error.message.includes(PIPELINE.listing.id), true);
});

Deno.test("a bigint or numeric column sent as a string reaches the console as a number", () => {
	const row = parseListingRow({
		...PIPELINE.listing,
		amount_cents: "120000",
		rating_average: "4.5",
	});
	assertEquals([row.amount_cents, row.rating_average], [120_000, 4.5]);
});

Deno.test("listingBySlug reads through the boundary", async () => {
	const answers = (listing: unknown) =>
		stubCatalogueClient({
			tables: { service_blueprints: [PIPELINE.blueprint], listings: [listing] },
		}).client;
	assertEquals(await listingBySlug(answers(PIPELINE.listing), "svc-brandpipe01"), PIPELINE.listing);
	await assertRejects(
		() => listingBySlug(answers({ ...PIPELINE.listing, status: "deleted" }), "svc-brandpipe01"),
		Error,
		"status:",
	);
});
// #endregion
