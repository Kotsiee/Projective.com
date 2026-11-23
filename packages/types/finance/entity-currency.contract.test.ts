/**
 * An entity's currency (Decision #337, ruling M5 (b); FBP DB9): `org.fn_currency_for_country`, the map
 * the create doors read, against `currencyForCountry`, the one the browser and the checkout read. Both
 * clamp to `settlement_currencies` (pinned in fx-conversion.test.ts) and fall to the platform base, so
 * here only the country → own-currency halves are compared, for every assigned country, on a laptop
 * with no database.
 */
import { assertEquals } from "@std/assert";
import { COUNTRIES } from "./countries.ts";
import { displayCurrencyForRegion } from "./fx.ts";

const ENTITIES = new URL(
	"../../../supabase/migrations/00001020_functions_org_entities.sql",
	import.meta.url,
);

/** The SQL map's own-currency answer for each code, read from the function's body. */
function sqlOwnCurrency(): (code: string) => string | undefined {
	const sql = Deno.readTextFileSync(ENTITIES);
	const body = /FUNCTION org\.fn_currency_for_country\(p_country text\)[\s\S]*?\$\$([\s\S]*?)\$\$/
		.exec(sql)?.[1];
	if (!body) throw new Error("org.fn_currency_for_country not found in 00001020");
	const euro = new Set(
		[.../ANY \(ARRAY\[([^\]]*)\]\) THEN 'EUR'/.exec(body)?.[1].matchAll(/'([A-Z]{2})'/g) ?? []].map(
			(m) => m[1],
		),
	);
	const pairs = new Map(
		[...body.matchAll(/WHEN '([A-Z]{2})' THEN '([A-Z]{3})'/g)].map((m) => [m[1], m[2]]),
	);
	return (code) => euro.has(code) ? "EUR" : pairs.get(code);
}

Deno.test("org.fn_currency_for_country names the same own currency as displayCurrencyForRegion", () => {
	const own = sqlOwnCurrency();
	for (const code of [...COUNTRIES.map((c) => c.code), "EU"]) {
		assertEquals(own(code), displayCurrencyForRegion(code), code);
	}
});
