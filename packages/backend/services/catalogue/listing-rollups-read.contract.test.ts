/**
 * `catalogue.get_listing_rollups` (00001170) is the only way the Analytics read reaches
 * `analytics.daily_rollups`; `live-catalogue-analytics.ts` reads its columns as a `RollupRow`. A
 * renamed column would read as zero forever, and a DEFINER door would bypass the table's policy, so
 * both have to fail here, without a database.
 */
import { assertEquals } from "@std/assert";
import type { RollupRow } from "./analytics-model.ts";

const MIGRATION = new URL(
	"../../../../supabase/migrations/00001170_functions_catalogue.sql",
	import.meta.url,
);

function header(): string {
	const sql = Deno.readTextFileSync(MIGRATION).replace(/\r\n/g, "\n");
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION catalogue.get_listing_rollups");
	const end = sql.indexOf("AS $$", start);
	if (start < 0 || end < 0) throw new Error("catalogue.get_listing_rollups not found in 00001170");
	return sql.slice(start, end);
}

const COLUMNS: ReadonlyArray<keyof RollupRow> = [
	"day",
	"metric",
	"subject_id",
	"dimensions",
	"value",
	"sample_count",
];

Deno.test("get_listing_rollups returns exactly the RollupRow columns", () => {
	const table = header().match(/RETURNS TABLE \(([^)]*)\)/)?.[1] ?? "";
	const names = table.split(",").map((c) => c.trim().split(/\s+/)[0]);
	assertEquals(names, [...COLUMNS]);
});

Deno.test("get_listing_rollups is INVOKER, so the rollups' own policy decides", () => {
	assertEquals(/SECURITY INVOKER/.test(header()), true);
	assertEquals(/SECURITY DEFINER/.test(header()), false);
});
