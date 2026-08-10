import {
	DEFAULT_LOCALE,
	type FxRateTable,
	PLATFORM_BASE_CURRENCY,
	toDisplayCurrency,
} from "@projective/types/finance";
import type { UserContext } from "@projective/types/auth";
import { setAmbientCurrencyResolver } from "@projective/ui/display/money";
import { FxService } from "@server/services/finance/FxService.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * currency-context.ts — resolves the request's money-presentation context for SSR.
 *
 * The HTTP-layer bridge between "who is asking" and "which currency their figures are drawn in". It
 * answers three things once per request, site-wide, so every surface renders money identically in the
 * first byte with no client round-trip:
 *
 *  - **display currency** — the viewer's chosen ISO-4217 formatting target;
 *  - **locale** — the BCP-47 locale `Intl.NumberFormat` is handed;
 *  - **rate table** — the multipliers the client needs to re-project a figure when the viewer
 *    switches currency without a page load.
 *
 * ## Resolution order, and why it is this way
 *
 * 1. **The JWT claim** (`app_metadata.active_context.displayCurrency`, stamped by
 *    `custom_access_token_hook` from `org.user_preferences`) — the authoritative stored preference,
 *    already on the request, costing no read.
 * 2. **The `pj.currency` cookie** — a guest has no JWT and no preferences row, but a guest still
 *    picks a currency, and it must survive a navigation. Written by the switcher alongside the PATCH.
 * 3. **The platform base.**
 *
 * The claim is checked FIRST on purpose. A signed-in user's stored preference is the truth; letting a
 * stale cookie win would mean signing in on a new device silently ignored the currency that user has
 * been using everywhere else.
 *
 * Every step is total — `toDisplayCurrency` narrows anything unrecognised to a currency the rate
 * table can actually price, so a tampered cookie or a legacy claim can never produce a symbol with no
 * rate behind it.
 */

/** The cookie the currency switcher writes so a guest's choice survives navigation. Not HttpOnly. */
export const CURRENCY_COOKIE = "pj.currency";

/** The locale cookie companion, for a guest who has no `org.user_preferences` row. */
export const LOCALE_COOKIE = "pj.locale";

/** The resolved presentation context handed to `ctx.state.currency`. */
export interface CurrencyContext {
	displayCurrency: string;
	locale: string;
	table: FxRateTable;
}

// #region Request-scoped ambient currency (SSR)
/**
 * The per-request currency, carried across the whole render via `AsyncLocalStorage`.
 *
 * **Why not Preact context, and why not a module signal.** Both were tried and measured. A context
 * provider at the document root is NOT visible to a server component deeper in the page: an island
 * boundary sits between them, and the framework renders island subtrees in a pass that does not carry
 * the outer context — an app-side probe beside a price returned `null` while the same probe directly
 * under the provider returned the real value. A module-level signal would be visible everywhere, but
 * a server renders many viewers concurrently, so one request writing "EUR" could change what another
 * is midway through rendering. That is a data race over money, and one that would pass every manual
 * test before misprinting a page in production.
 *
 * `AsyncLocalStorage` is the primitive that has neither problem: it is scoped to one request and it
 * survives every `await` and every render pass inside it. The middleware opens the scope around
 * `ctx.next()`, so every server-rendered figure in that request — at any depth, inside any island
 * subtree — resolves the same currency.
 */
const currencyScope = new AsyncLocalStorage<CurrencyContext>();

/** Run `fn` with `value` as the ambient currency for the whole async subtree. */
export function runWithCurrency<T>(value: CurrencyContext, fn: () => T): T {
	return currencyScope.run(value, fn);
}

/**
 * Install the ambient resolver into `@projective/ui/display`, once, at module load.
 *
 * A side effect on import is deliberate: the resolver must be in place before the first render, and
 * this module is already imported by the global middleware that opens the scope, so the two cannot
 * get out of order. It is server-only — this module is never reached from a client bundle, so the
 * browser keeps the reactive signal-store path.
 */
setAmbientCurrencyResolver(() => currencyScope.getStore() ?? null);
// #endregion

/**
 * Resolve the request's currency context. Never throws: an FX read that fails yields the engine's
 * seeded fallback table, so the worst case is figures rendered at reference rates, never an error.
 */
export async function resolveCurrencyContext(
	req: Request,
	context: UserContext | undefined,
): Promise<CurrencyContext> {
	const cookies = readCookies(req);

	// A signed-in viewer's stored preference (via the JWT claim) outranks any cookie on this device.
	const claimed = context?.userId ? context.displayCurrency : undefined;
	const displayCurrency = toDisplayCurrency(
		claimed ?? cookies[CURRENCY_COOKIE] ?? PLATFORM_BASE_CURRENCY,
	);
	const locale = (context?.userId ? context.locale : undefined) ??
		cookies[LOCALE_COOKIE] ??
		DEFAULT_LOCALE;

	// Always quoted against the PLATFORM base, not the viewer's currency: one table serves every
	// viewer, so it is cached once and shared, and `resolveRate` triangulates any pair through it.
	// Re-basing per viewer would multiply the cache by the number of currencies for no gained
	// precision.
	const table = await FxService.rates(PLATFORM_BASE_CURRENCY);

	return { displayCurrency, locale, table };
}
