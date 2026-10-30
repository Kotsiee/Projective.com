import { assertEquals, assertExists } from "@std/assert";
import { DISPLAY_CURRENCIES } from "./fx.ts";
import { paramMinor, PerCurrencyMinorSchema } from "./ledger.ts";

const SEED = new URL(
	"../../../supabase/migrations/00005001_seed_platform_params.sql",
	import.meta.url,
);

Deno.test("paramMinor — the currency's own entry, else the default, else null", () => {
	const map = { GBP: 2_500_000, INR: 270_000_000, default: 7 };
	assertEquals(paramMinor(map, "INR"), 270_000_000);
	assertEquals(paramMinor(map, " gbp "), 2_500_000);
	assertEquals(paramMinor(map, "JPY"), 7);
	assertEquals(paramMinor({ INR: 270_000_000 }, "JPY"), null);
});

Deno.test("paramMinor — a bare number is the default; any other shape is unset", () => {
	assertEquals(paramMinor(50_000, "INR"), 50_000);
	assertEquals(paramMinor(50_000, "GBP"), paramMinor({ default: 50_000 }, "GBP"));
	assertEquals(paramMinor(null, "GBP"), null);
	assertEquals(paramMinor("50000", "GBP"), null);
	assertEquals(paramMinor({ GBP: -1 }, "GBP"), null);
});

Deno.test("the seeded maps parse, and the on-account limit names every display currency and no default", () => {
	const sql = Deno.readTextFileSync(SEED);
	const seeded = (key: string) => {
		const match = sql.match(new RegExp(`\\('${key}',\\s*'([^']+)'::jsonb`));
		assertExists(match, `${key} is no longer seeded in 00005001`);
		return PerCurrencyMinorSchema.parse(JSON.parse(match[1]));
	};
	assertEquals(seeded("vault_approval_threshold_cents"), { default: 0 });
	assertEquals(
		Object.keys(seeded("on_account_limit_cents")).sort(),
		DISPLAY_CURRENCIES.map((c) => c.code).sort(),
	);
});
