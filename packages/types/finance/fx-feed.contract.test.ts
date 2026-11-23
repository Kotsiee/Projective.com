import { assert, assertEquals } from "@std/assert";
import {
	DISPLAY_CURRENCIES,
	FX_PROVIDER_SLUG,
	FX_RATE_LITERAL,
	FX_RATE_MAX_AGE_HOURS,
	PLATFORM_BASE_CURRENCY,
} from "./fx.ts";

/**
 * fx-feed.contract — the daily FX feed's three agreements with the database (FBP DB17; Decision
 * #337, ruling M5 (f); Decision #471):
 *
 * - one staleness window: FxService's STALE_AFTER_MS is {@link FX_RATE_MAX_AGE_HOURS}, and the quote
 *   door refuses a rate after the seeded `fx_rate_max_age_hours` (`00005001`); the two are equal;
 * - one currency set: a feed must quote what the seed floor holds against the base
 *   (`finance.fn_fx_feed_currencies`, `00005050`), and that is {@link DISPLAY_CURRENCIES};
 * - one rate rule: `finance.record_fx_rates` (`00001200`) applies the patterns this package exports.
 */

// #region Sources
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);

function migration(name: string): string {
	return Deno.readTextFileSync(new URL(name, MIGRATIONS));
}
// #endregion

Deno.test("fx feed contract: the staleness window is one value in TypeScript and the database", () => {
	const params = migration("00005001_seed_platform_params.sql");
	const match = /\('fx_rate_max_age_hours',\s*'(\d+)'::jsonb/.exec(params);
	assert(match, "00005001 seeds fx_rate_max_age_hours");
	assertEquals(Number(match[1]), FX_RATE_MAX_AGE_HOURS);
});

Deno.test("fx feed contract: a feed quotes exactly the display currencies the seed floor holds", () => {
	const seed = migration("00005050_seed_reference_data.sql");
	const floor = [
		...seed.matchAll(
			new RegExp(
				`\\('${PLATFORM_BASE_CURRENCY}',\\s*'([A-Z]{3})',\\s*[0-9.]+,\\s*TIMESTAMPTZ '[^']+',\\s*'seed'\\)`,
				"g",
			),
		),
	].map((m) => m[1]).sort();
	assertEquals(floor, DISPLAY_CURRENCIES.map((c) => c.code).sort());
	const core = migration("00001200_functions_finance_core.sql");
	assert(core.includes("WHERE r.provider = 'seed'"), "fn_fx_feed_currencies reads the seed floor");
});

Deno.test("fx feed contract: the door applies the rate and provider patterns this package exports", () => {
	const core = migration("00001200_functions_finance_core.sql");
	assert(core.includes(String.raw`'^[0-9]{1,10}(\.[0-9]{1,10})?$'`), "the rate pattern");
	assert(core.includes("'^[a-z0-9][a-z0-9_.-]{0,59}$'"), "the provider pattern");
	for (const ok of ["1", "1.2712345678", "2034.5", "0000000001.0000000001"]) {
		assert(FX_RATE_LITERAL.test(ok), ok);
	}
	for (const bad of ["1.27123456789", "12345678901", "1e2", "-1", ".5", "1.", " 1", "1,27"]) {
		assert(!FX_RATE_LITERAL.test(bad), bad);
	}
	assert(FX_PROVIDER_SLUG.test("vendor.fx-1") && !FX_PROVIDER_SLUG.test("Vendor"));
});
