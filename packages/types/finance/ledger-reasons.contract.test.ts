/**
 * The TypeScript mirrors of three finance SQL vocabularies, read from the consolidated migrations
 * (FINANCE DB8; FCA N24, N36; FA C16).
 *
 * - {@link LEDGER_KIND_REASONS} files every `finance.transactions.reason` code the CHECK admits, except
 *   the simulator's `simulated_*`, in exactly one family, and names no code the CHECK refuses.
 * - {@link EscrowStatus} and {@link WalletOwnerType} are the `escrows.status` and `wallets.owner_type`
 *   CHECK lists.
 * - {@link PLATFORM_BASE_CURRENCY} is the seeded `base_currency` param and the `fx_base` defaults.
 */
import { assertEquals } from "@std/assert";
import { readRepoFile } from "../core/table-contract.ts";
import { PLATFORM_BASE_CURRENCY } from "./fx.ts";
import { EscrowStatus, WalletOwnerType } from "./ledger.ts";
import { LEDGER_KIND_REASONS } from "./wallet.ts";

const TABLES = readRepoFile("supabase/migrations/00000017_tables_finance.sql");

/** The quoted codes of `<column> ... CHECK (<column> IN (...))` inside one CREATE TABLE. */
function checkList(table: string, column: string): string[] {
	const body = TABLES.slice(TABLES.indexOf(`CREATE TABLE ${table} (`)).replace(/--[^\n]*/g, "");
	const check = new RegExp(`\\n\\s+${column} [^,]*?CHECK \\(${column} IN \\(([^)]*)\\)`).exec(body);
	if (!check) throw new Error(`no ${table}.${column} CHECK list`);
	return [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

Deno.test("LEDGER_KIND_REASONS files every real reason the CHECK admits, once", () => {
	const admitted = checkList("finance.transactions", "reason").filter((r) =>
		!r.startsWith("simulated_")
	);
	const mapped = Object.values(LEDGER_KIND_REASONS).flat();
	assertEquals([...mapped].sort(), admitted);
	assertEquals(new Set(mapped).size, mapped.length);
});

Deno.test("EscrowStatus and WalletOwnerType are the CHECK lists", () => {
	assertEquals([...EscrowStatus.options].sort(), checkList("finance.escrows", "status"));
	assertEquals([...WalletOwnerType.options].sort(), checkList("finance.wallets", "owner_type"));
});

Deno.test("PLATFORM_BASE_CURRENCY is the seeded base_currency and the fx_base default", () => {
	const params = readRepoFile("supabase/migrations/00005001_seed_platform_params.sql");
	assertEquals(
		/\('base_currency', '"([A-Z]{3})"'::jsonb/.exec(params)?.[1],
		PLATFORM_BASE_CURRENCY,
	);
	const defaults = [...TABLES.matchAll(/fx_base char\(3\) DEFAULT '([A-Z]{3})'/g)].map((m) => m[1]);
	assertEquals(defaults, [PLATFORM_BASE_CURRENCY, PLATFORM_BASE_CURRENCY]);
});
