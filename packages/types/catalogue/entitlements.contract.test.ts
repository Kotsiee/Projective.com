/**
 * The product version and entitlement row schemas against the tables that store them (Decision #488).
 *
 * A column added to either table in `00000023_tables_catalogue.sql` without a Zod key, a key with no
 * column, or an enum member out of step with its Postgres type fails here with no database.
 */
import { assert, assertEquals } from "@std/assert";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { ListingLicence } from "./offer.ts";
import {
	DELIVERY_TERMS_KEY,
	downloadHref,
	EntitlementHolderType,
	EntitlementStatus,
	ProductEntitlementRowSchema,
	ProductVersionRowSchema,
	purchasesHref,
} from "./entitlements.ts";

// #region Sources
const TABLES_SQL = readRepoFile("supabase/migrations/00000023_tables_catalogue.sql");
const DOMAIN_ENUMS_SQL = readRepoFile("supabase/migrations/00000004_enums_domains.sql");
const WALLET_SQL = readRepoFile("supabase/migrations/00001210_functions_finance_kyc_wallet.sql");

/** The quoted literals of the first `(...)` list after `anchor` in `sql`. */
function literalsAfter(sql: string, anchor: string): string[] {
	const at = sql.indexOf(anchor);
	assert(at >= 0, `anchor not found: ${anchor}`);
	const open = sql.indexOf("(", at + anchor.length - 1);
	return [...sql.slice(open + 1, sql.indexOf(")", open)).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
// #endregion

// #region Columns
for (
	const [table, keys] of [
		["catalogue.product_versions", Object.keys(ProductVersionRowSchema.shape)],
		["catalogue.entitlements", Object.keys(ProductEntitlementRowSchema.shape)],
	] as const
) {
	Deno.test(`${table} ⇄ its row schema: zero drift`, () => {
		const drift = columnDrift(tableColumns(TABLES_SQL, table), [...keys]);
		assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
	});
}
// #endregion

// #region Vocabularies
Deno.test("the entitlement enums are their Postgres types, member for member, in order", () => {
	assertEquals(
		literalsAfter(DOMAIN_ENUMS_SQL, "CREATE TYPE catalogue.entitlement_status AS ENUM ("),
		[...EntitlementStatus.options],
	);
	assertEquals(
		literalsAfter(DOMAIN_ENUMS_SQL, "CREATE TYPE files.owner_kind AS ENUM ("),
		[...EntitlementHolderType.options],
	);
	assertEquals(
		literalsAfter(DOMAIN_ENUMS_SQL, "CREATE TYPE catalogue.product_licence AS ENUM ("),
		[...ListingLicence.options],
	);
});

Deno.test("the checkout door reads the A8 tick under the key the checkout writes", () => {
	assert(
		WALLET_SQL.includes(`metadata -> '${DELIVERY_TERMS_KEY}' = 'true'::jsonb`),
		"place_wallet_order no longer reads the A8 key",
	);
});
// #endregion

// #region Addresses
Deno.test("a download address encodes each segment and names no storage location", () => {
	assertEquals(
		downloadHref("ent-23456789ab", "0b9b0f8e-6c1d-4c4e-9f43-0d3a3f0b1c2d"),
		"/api/downloads/ent-23456789ab/0b9b0f8e-6c1d-4c4e-9f43-0d3a3f0b1c2d",
	);
	assertEquals(downloadHref("ent-x/../y", "a b"), "/api/downloads/ent-x%2F..%2Fy/a%20b");
	assertEquals(purchasesHref(), "/files?source=purchases");
	assertEquals(
		purchasesHref("ent-23456789ab"),
		"/files?source=purchases&entitlement=ent-23456789ab",
	);
});
// #endregion
