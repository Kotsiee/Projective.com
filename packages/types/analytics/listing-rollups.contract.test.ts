/**
 * `analytics.fn_rollup_listings` (00001600) writes metric names and dimension keys as SQL literals that
 * the catalogue's Analytics reads back through `ListingRollupMetric`. A renamed metric would be read
 * as zero forever, and a drifted keyword threshold would print queries from too few sessions, so both
 * have to fail here, on a laptop with no database.
 */
import { assertEquals } from "@std/assert";
import { LISTING_ROLLUP_DIMENSIONS, ListingRollupMetric } from "./events.ts";
import { KEYWORD_MIN_SESSIONS, LISTING_ROLLUP_SETTLED_UTC_MINUTE } from "../catalogue/analytics.ts";

const MIGRATION = new URL(
	"../../../supabase/migrations/00001600_functions_analytics.sql",
	import.meta.url,
);
const SEED = new URL(
	"../../../supabase/migrations/00005060_seed_scheduled_jobs.sql",
	import.meta.url,
);
const read = (url: URL) => Deno.readTextFileSync(url).replace(/\r\n/g, "\n");

function rollupBody(): string {
	const sql = read(MIGRATION);
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION analytics.fn_rollup_listings");
	const end = sql.indexOf("\n$$;", start);
	if (start < 0 || end < 0) throw new Error("analytics.fn_rollup_listings not found in 00001600");
	return sql.slice(start, end);
}

Deno.test("fn_rollup_listings writes exactly the ListingRollupMetric vocabulary", () => {
	const written = new Set([...rollupBody().matchAll(/'(listing\.[a-z_]+)'/g)].map((m) => m[1]));
	assertEquals([...written].sort(), [...ListingRollupMetric.options].sort());
});

Deno.test("each listing metric carries the dimensions LISTING_ROLLUP_DIMENSIONS declares", () => {
	const pattern =
		/'(listing\.[a-z_]+)',\s*(?:'\{\}'::jsonb|pg_catalog\.jsonb_build_object\(([^)]*)\))/g;
	const seen: Record<string, string[]> = {};
	for (const m of rollupBody().matchAll(pattern)) {
		const keys = m[2] ? [...m[2].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]) : [];
		seen[m[1]] = keys;
	}
	assertEquals(
		seen,
		Object.fromEntries(Object.entries(LISTING_ROLLUP_DIMENSIONS).map(([k, v]) => [k, [...v]])),
	);
});

Deno.test("the keyword k-anonymity threshold is KEYWORD_MIN_SESSIONS", () => {
	const m = rollupBody().match(/HAVING pg_catalog\.count\(DISTINCT i\.visitor\) >= (\d+)/);
	assertEquals(m ? Number(m[1]) : null, KEYWORD_MIN_SESSIONS);
});

Deno.test("the analytics-listing-rollups job rolls up yesterday", () => {
	const seed = read(SEED);
	const row = seed.slice(seed.indexOf("('analytics-listing-rollups'"));
	assertEquals(row.includes("'SELECT analytics.fn_rollup_listings(current_date - 1);'"), true);
});

Deno.test("the job runs before the analytics window treats yesterday as rolled up", () => {
	const seed = read(SEED);
	const row = seed.slice(seed.indexOf("('analytics-listing-rollups'"));
	const m = row.match(/'sql', '(\d+) (\d+) \* \* \*'/);
	const runMinute = m ? Number(m[2]) * 60 + Number(m[1]) : Infinity;
	assertEquals(runMinute < LISTING_ROLLUP_SETTLED_UTC_MINUTE, true);
});
