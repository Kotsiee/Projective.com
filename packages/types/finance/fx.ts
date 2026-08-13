import { z } from "zod";
import { currency, minorUnits, timestamp } from "./common.ts";

/**
 * finance/fx — the Zod SSOT for **presentational currency conversion**: the rate table the FX engine
 * caches, the quote it resolves a single pair to, and the converted figure it hands back.
 *
 * ## The one rule this module exists to protect
 *
 * A conversion is a **read-time projection over an immutable origin**. `finance.transactions`,
 * `finance.escrows`, `projects.projects` and every other priced row keep the `(amount_minor,
 * currency)` they were written with, forever; nothing here rewrites one. When a figure needs to
 * settle rather than merely be read, the authoritative rate is the `(fx_rate, fx_base, fx_as_of)`
 * {@link FxSnapshot} stamped on that row at commit — not whatever this module resolves today. So a
 * {@link ConvertedAmount} always carries its `origin` and its `asOf` alongside the converted figure:
 * a reader can always recover what was actually agreed, and a statement can always reprint the rate
 * that was actually applied.
 *
 * ## Direction
 *
 * `rate` converts BASE into QUOTE — `amount_quote = amount_base × rate` — matching
 * `finance.fx_rates` exactly. This is stated once, here, and never re-derived: a caller that divides
 * by a forward rate and a caller that multiplies by its inverse disagree in the last minor unit, and
 * a money figure that changes with which direction the caller happened to ask in is a worse failure
 * than one that is merely stale.
 *
 * Only regex/min/max/enum/number/string primitives are used, so the schemas stay stable across Zod
 * majors (matching `common.ts`). A leaf module: it imports `common.ts` and nothing else, so the
 * `finance` domain graph stays acyclic and this file is safe to import from anywhere.
 */

// #region Rate table
/** The platform's base currency — the pivot every seeded pair is quoted against. */
export const PLATFORM_BASE_CURRENCY = "GBP";

/** The fallback locale when a viewer has no resolved `org.user_preferences.locale`. */
export const DEFAULT_LOCALE = "en-GB";

/**
 * The FX rate table for one base currency: `rates[quote]` is the multiplier from `base` into
 * `quote`. Flat and JSON-serialisable on purpose — this is the shape the server ships into SSR and
 * caches, so the client can re-project a figure into a newly-chosen display currency without a round
 * trip, using the exact numbers the server would have used.
 */
export const FxRateTableSchema = z.object({
	/** The base currency every `rates` entry is quoted against. */
	base: currency,
	/** `quote code → multiplier`. Always contains `base → 1`. */
	rates: z.record(z.string(), z.number().positive()),
	/** The newest `finance.fx_rates.as_of` in this table — what "current" means for these numbers. */
	asOf: timestamp,
	/** Rate source (`stripe` / `ecb` / `seed` / a provider slug). `seed` marks reference data. */
	provider: z.string().max(60),
	/** Whether the table is older than the engine's freshness window and should be disclosed as such. */
	stale: z.boolean(),
});
export type FxRateTable = z.infer<typeof FxRateTableSchema>;

/** A single resolved pair — the smallest unit of FX truth. */
export const FxQuoteSchema = z.object({
	base: currency,
	quote: currency,
	/** `amount_quote = amount_base × rate`. */
	rate: z.number().positive(),
	asOf: timestamp,
	provider: z.string().max(60),
	stale: z.boolean(),
});
export type FxQuote = z.infer<typeof FxQuoteSchema>;
// #endregion

// #region Converted amount (the conversion response)
/** The immutable origin of a converted figure — what was actually priced, stored and agreed. */
export const ConversionOriginSchema = z.object({
	minor: minorUnits,
	currency,
});
export type ConversionOrigin = z.infer<typeof ConversionOriginSchema>;

/**
 * The result of converting one amount into a display currency.
 *
 * `converted` is `true` only when the currencies actually differed AND a rate was resolvable. When a
 * pair has no rate the engine returns the ORIGIN unchanged with `converted: false` — it never
 * invents a rate, and it never silently relabels an amount with a currency symbol it was not priced
 * in, which is the one FX failure mode that produces a wrong number rather than a missing one.
 */
export const ConvertedAmountSchema = z.object({
	/** The amount in {@link currency}, in integer minor units. */
	minor: minorUnits,
	/** The currency {@link minor} is expressed in — the display target when `converted`. */
	currency,
	/** The untouched origin `(amount, currency)`. Identical to the result when `converted` is false. */
	origin: ConversionOriginSchema,
	/** The multiplier applied (`1` when not converted). */
	rate: z.number().positive(),
	/** The exact `finance.fx_rates.as_of` this rate was observed at — the snapshot instant. */
	asOf: timestamp,
	/** The rate source, so a `seed` or stale observation is always distinguishable from a live one. */
	provider: z.string().max(60),
	/** Whether a currency change was actually applied. */
	converted: z.boolean(),
	/** Whether the rate used is older than the engine's freshness window. */
	stale: z.boolean(),
});
export type ConvertedAmount = z.infer<typeof ConvertedAmountSchema>;

/** Query params for the thin `GET /api/finance/fx` rate-table read. */
export const FxRatesParamsSchema = z.object({
	/** The base to quote everything against. Defaults to the platform base. */
	base: currency.optional(),
});
export type FxRatesParams = z.infer<typeof FxRatesParamsSchema>;
// #endregion

// #region Supported display currencies
/**
 * The display currencies a viewer may choose. Deliberately a CURATED list, not "every ISO-4217
 * code": every entry here must have a seeded rate in both directions
 * (`00005050_seed_reference_data.sql`), because offering a currency the table cannot resolve would
 * render an unconverted origin amount under the wrong symbol.
 */
export interface DisplayCurrencyOption {
	/** ISO-4217 code. */
	code: string;
	/** The currency's own name, for the switcher's label. */
	label: string;
	/**
	 * A compact glyph for the switcher's leading column. **Never used to format an amount** — `Intl`
	 * owns that, and it may legitimately choose a different form for the same currency (yen renders
	 * as `JP¥` in `en-GB` and `￥` in `ja-JP`). This is the currency's own symbol, shown beside its
	 * code so the list is scannable; the figure on screen is always whatever `Intl` produced.
	 */
	symbol: string;
	/**
	 * The issuing territory's flag, as a regional-indicator emoji pair.
	 *
	 * Stored explicitly rather than derived from the first two letters of {@link code}. The
	 * derivation happens to work for all twelve entries below — including `EUR` → `EU`, which has a
	 * real flag — but it is a coincidence of ISO-4217's country-plus-letter convention, and the first
	 * supranational or commodity code added (`XAF`, `XOF`, `XAU`) would silently render two unrelated
	 * letter glyphs instead of a flag.
	 *
	 * It is **decoration and must be `aria-hidden` at every render site**: a screen reader announcing
	 * "flag of the United Kingdom, GBP, British Pound" buries the two facts that identify the
	 * currency behind one that does not. The code and the label carry the meaning.
	 */
	flag: string;
}

/** The curated switcher list, in menu order (platform base first, then by usage). */
export const DISPLAY_CURRENCIES: readonly DisplayCurrencyOption[] = Object.freeze([
	{ code: "GBP", label: "British Pound", symbol: "£", flag: "🇬🇧" },
	{ code: "USD", label: "US Dollar", symbol: "$", flag: "🇺🇸" },
	{ code: "EUR", label: "Euro", symbol: "€", flag: "🇪🇺" },
	{ code: "CAD", label: "Canadian Dollar", symbol: "CA$", flag: "🇨🇦" },
	{ code: "AUD", label: "Australian Dollar", symbol: "A$", flag: "🇦🇺" },
	{ code: "JPY", label: "Japanese Yen", symbol: "¥", flag: "🇯🇵" },
	{ code: "INR", label: "Indian Rupee", symbol: "₹", flag: "🇮🇳" },
	{ code: "SGD", label: "Singapore Dollar", symbol: "S$", flag: "🇸🇬" },
	{ code: "CHF", label: "Swiss Franc", symbol: "CHF", flag: "🇨🇭" },
	{ code: "ZAR", label: "South African Rand", symbol: "R", flag: "🇿🇦" },
	{ code: "NGN", label: "Nigerian Naira", symbol: "₦", flag: "🇳🇬" },
	{ code: "AED", label: "UAE Dirham", symbol: "AED", flag: "🇦🇪" },
]);

/** Whether `code` is an offerable display currency. Case-insensitive. */
export function isDisplayCurrency(code: string | null | undefined): boolean {
	if (!code) return false;
	const upper = code.toUpperCase();
	return DISPLAY_CURRENCIES.some((c) => c.code === upper);
}

/**
 * Narrow an arbitrary string to a supported display currency, else the platform base. Total — used
 * on every boundary (JWT claim, query param, `localStorage`) so an unknown code degrades to a
 * currency that is guaranteed to resolve rather than to a symbol with no rate behind it.
 */
export function toDisplayCurrency(code: string | null | undefined): string {
	const upper = (code ?? "").trim().toUpperCase();
	return isDisplayCurrency(upper) ? upper : PLATFORM_BASE_CURRENCY;
}
// #endregion

// #region Pure conversion math (shared server + client)
/**
 * Resolve the multiplier from `from` into `to` using a table quoted against `table.base`.
 *
 * Three cases, in order: the pair is the identity (`1`); the table's base IS one side, so a single
 * hop answers it; otherwise **triangulate through the base** — `from → base → to`, i.e.
 * `(1 / rates[from]) × rates[to]`. Returns `null` when either leg is missing, which callers must
 * treat as "do not convert", never as "assume 1".
 */
export function resolveRate(
	table: Pick<FxRateTable, "base" | "rates">,
	from: string,
	to: string,
): number | null {
	const base = table.base.toUpperCase();
	const src = from.toUpperCase();
	const dst = to.toUpperCase();
	if (src === dst) return 1;

	if (src === base) {
		const direct = table.rates[dst];
		return typeof direct === "number" && direct > 0 ? direct : null;
	}
	if (dst === base) {
		const inverse = table.rates[src];
		return typeof inverse === "number" && inverse > 0 ? 1 / inverse : null;
	}

	const toBase = table.rates[src];
	const fromBase = table.rates[dst];
	if (typeof toBase !== "number" || toBase <= 0) return null;
	if (typeof fromBase !== "number" || fromBase <= 0) return null;
	return fromBase / toBase;
}

/**
 * Convert an integer minor-unit amount between currencies of possibly different exponents.
 *
 * The exponent shift matters and is easy to lose: 1000 JPY (exponent 0) is ¥1000, while 1000 GBP
 * minor units (exponent 2) is £10.00. Converting minor→minor without re-scaling would silently
 * inflate a yen figure a hundredfold. So the amount is lifted to major units, multiplied, and
 * re-scaled to the TARGET's exponent — with a single `Math.round` at the end, because rounding twice
 * accumulates a bias that shows up as a penny drift across a long ledger.
 */
export function convertMinorUnits(
	minor: number,
	rate: number,
	fromExponent: number,
	toExponent: number,
): number {
	const major = minor / 10 ** fromExponent;
	return Math.round(major * rate * 10 ** toExponent);
}
// #endregion
