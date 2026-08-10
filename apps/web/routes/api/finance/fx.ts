import { define } from "@web/utils/state.ts";
import { PLATFORM_BASE_CURRENCY, toDisplayCurrency } from "@projective/types/finance";
import { FxService } from "@server/services/finance/FxService.ts";

/**
 * `GET /api/finance/fx?base=GBP` — the current FX rate table.
 *
 * Thin by contract: narrow the requested base to a supported currency and delegate to the fat
 * {@link FxService}, which owns the cache, the live read and the fallback. Nothing is computed here.
 *
 * **Public on purpose.** FX rates are reference data, not user data — the `finance.fx_rates` RLS
 * policy is `USING (true)` — and a signed-out visitor browsing Explore needs prices in their chosen
 * currency exactly as much as a signed-in one does. Requiring a session here would mean guests silently
 * saw unconverted origin amounts.
 *
 * The response is cacheable for the same window the service caches internally (15 minutes), so a
 * client that re-fetches after switching to a currency the SSR table did not carry is answered from
 * the edge rather than the database.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const requested = new URL(ctx.req.url).searchParams.get("base");
		// Narrowed, never trusted: an unsupported base would produce a table whose pairs cannot resolve.
		const base = requested ? toDisplayCurrency(requested) : PLATFORM_BASE_CURRENCY;
		const table = await FxService.rates(base);

		return Response.json({ ok: true, table }, {
			status: 200,
			headers: { "cache-control": "public, max-age=900" },
		});
	},
});
