/**
 * The offered locales and display currencies exist twice — here and as reference data the sign-up
 * seeders validate against (`org.supported_locales`, `finance.fx_rates`, Decision #207). A tag one side
 * offers and the other refuses would silently fall back to the default, so the gap fails here.
 */
import { assertEquals } from "@std/assert";
import { DISPLAY_CURRENCIES, PLATFORM_BASE_CURRENCY } from "../finance/fx.ts";
import { SUPPORTED_LOCALES } from "./locales.ts";

const SEED = new URL(
	"../../../supabase/migrations/00005050_seed_reference_data.sql",
	import.meta.url,
);
const seed = Deno.readTextFileSync(SEED).replace(/\r\n/g, "\n");

/** The text of the INSERT statement into `table`, up to its terminating `;`. */
function insertInto(table: string): string {
	const statement = seed.match(new RegExp(`INSERT INTO\\s+${table.replace(".", "\\.")}\\b[^;]*;`));
	if (!statement) throw new Error(`no INSERT INTO ${table} in 00005050`);
	return statement[0];
}

Deno.test("org.supported_locales seeds exactly SUPPORTED_LOCALES, in order", () => {
	const tags = [...insertInto("org.supported_locales").matchAll(/\('([^']+)'\)/g)].map((m) => m[1]);
	assertEquals(tags, [...SUPPORTED_LOCALES]);
});

Deno.test("finance.fx_rates seeds both directions for every offered display currency", () => {
	const pairs = new Set(
		[...insertInto("finance.fx_rates").matchAll(/\('([A-Z]{3})', '([A-Z]{3})'/g)].map((m) =>
			`${m[1]}>${m[2]}`
		),
	);
	for (const { code } of DISPLAY_CURRENCIES) {
		if (code === PLATFORM_BASE_CURRENCY) continue;
		assertEquals(
			pairs.has(`${PLATFORM_BASE_CURRENCY}>${code}`),
			true,
			`${PLATFORM_BASE_CURRENCY}>${code}`,
		);
		assertEquals(
			pairs.has(`${code}>${PLATFORM_BASE_CURRENCY}`),
			true,
			`${code}>${PLATFORM_BASE_CURRENCY}`,
		);
	}
});
