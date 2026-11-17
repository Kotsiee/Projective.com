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
	 * The issuing territory — ISO 3166-1 alpha-2, or `EU` — whose circular flag the picker draws
	 * (`@projective/ui` `Flag`).
	 *
	 * Stored explicitly rather than derived from the first two letters of {@link code}. The
	 * derivation happens to work for all twelve entries below — including `EUR` → `EU` — but it is a
	 * coincidence of ISO-4217's country-plus-letter convention, and the first supranational or
	 * commodity code added (`XAF`, `XOF`, `XAU`) would silently draw an unrelated flag.
	 *
	 * The flag is **decoration** at every render site: a screen reader announcing "flag of the United
	 * Kingdom, GBP, British Pound" buries the two facts that identify the currency behind one that
	 * does not. The code and the label carry the meaning.
	 */
	country: string;
	/** The issuing territory's name — the picker's second line (`United States`). */
	countryName: string;
}

/** The curated switcher list, in menu order (platform base first, then by usage). */
export const DISPLAY_CURRENCIES: readonly DisplayCurrencyOption[] = Object.freeze([
	{
		code: "GBP",
		label: "British Pound",
		symbol: "£",
		country: "GB",
		countryName: "United Kingdom",
	},
	{ code: "USD", label: "US Dollar", symbol: "$", country: "US", countryName: "United States" },
	{ code: "EUR", label: "Euro", symbol: "€", country: "EU", countryName: "European Union" },
	{ code: "CAD", label: "Canadian Dollar", symbol: "CA$", country: "CA", countryName: "Canada" },
	{
		code: "AUD",
		label: "Australian Dollar",
		symbol: "A$",
		country: "AU",
		countryName: "Australia",
	},
	{ code: "JPY", label: "Japanese Yen", symbol: "¥", country: "JP", countryName: "Japan" },
	{ code: "INR", label: "Indian Rupee", symbol: "₹", country: "IN", countryName: "India" },
	{ code: "SGD", label: "Singapore Dollar", symbol: "S$", country: "SG", countryName: "Singapore" },
	{ code: "CHF", label: "Swiss Franc", symbol: "CHF", country: "CH", countryName: "Switzerland" },
	{
		code: "ZAR",
		label: "South African Rand",
		symbol: "R",
		country: "ZA",
		countryName: "South Africa",
	},
	{ code: "NGN", label: "Nigerian Naira", symbol: "₦", country: "NG", countryName: "Nigeria" },
	{
		code: "AED",
		label: "UAE Dirham",
		symbol: "AED",
		country: "AE",
		countryName: "United Arab Emirates",
	},
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

/** The euro area plus the territories that use the euro without being members. */
const EURO_REGIONS: ReadonlySet<string> = new Set([
	"AT",
	"BE",
	"BG",
	"CY",
	"DE",
	"EE",
	"ES",
	"FI",
	"FR",
	"GR",
	"HR",
	"IE",
	"IT",
	"LT",
	"LU",
	"LV",
	"MT",
	"NL",
	"PT",
	"SI",
	"SK",
	"AD",
	"MC",
	"ME",
	"SM",
	"VA",
	"XK",
]);

/**
 * The offerable display currency a region (ISO 3166-1 alpha-2) uses, else `undefined` — a sign-up
 * hint, never a charge currency.
 */
export function displayCurrencyForRegion(region: string | null | undefined): string | undefined {
	const upper = region?.trim().toUpperCase();
	if (!upper) return undefined;
	if (EURO_REGIONS.has(upper)) return "EUR";
	return DISPLAY_CURRENCIES.find((c) => c.country === upper)?.code;
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

// #region Settlement and conversion (Decision #435)
/**
 * The currencies money settles in on the GB platform (Decision #423 (B)): a conversion is quoted only
 * between two of these, and a buyer is billed in one of them. AED, INR and NGN stay display-only.
 * Mirrors `security.platform_params.settlement_currencies`.
 */
export const SETTLEMENT_CURRENCIES: readonly string[] = Object.freeze([
	"GBP",
	"USD",
	"EUR",
	"CAD",
	"AUD",
	"JPY",
	"SGD",
	"CHF",
	"ZAR",
]);

/** Whether Projective settles money in `code`. */
export function isSettlementCurrency(code: string | null | undefined): boolean {
	return !!code && SETTLEMENT_CURRENCIES.includes(code.trim().toUpperCase());
}

/**
 * The currency a billing country pays in (Decision #435 (B), ruling M5 (b)): the country's own currency
 * when Projective settles it, else the platform base. A display preference never decides it.
 */
export function currencyForCountry(country: string | null | undefined): string {
	const own = displayCurrencyForRegion(country);
	return own && isSettlementCurrency(own) ? own : PLATFORM_BASE_CURRENCY;
}

/** The scale of a stored rate: `numeric(20, 10)`, ten decimal places. */
const RATE_SCALE = 10_000_000_000n;

/**
 * A rate as an exact integer scaled by 10¹⁰, from the decimal string or number the database returned.
 * Refuses anything that is not a positive decimal with at most ten places.
 */
export function parseFixedRate(rate: string | number): bigint {
	const text = typeof rate === "number" ? rate.toFixed(10) : rate.trim();
	const match = /^(\d+)(?:\.(\d{1,10}))?$/.exec(text);
	if (!match) throw new RangeError(`Not a stored exchange rate: ${String(rate)}`);
	const scaled = BigInt(match[1]) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(10, "0"));
	if (scaled <= 0n) throw new RangeError(`An exchange rate must be positive: ${String(rate)}`);
	return scaled;
}

/** What a conversion quote charges, in the payer's currency's minor units. */
export interface ConversionCharge {
	/** The mid-market cost of the delivered amount, truncated. */
	principalMinor: number;
	/** The margin on {@link principalMinor}, truncated (Decision #187). */
	spreadMinor: number;
	/** What the payer is charged: principal + margin. */
	fromMinor: number;
}

/**
 * The price of `toMinor` in the payer's currency — the exact mirror of `finance.fn_fx_quote_minor`.
 * `fromRate` and `toRate` are the two currencies' platform-base rates (`amount_quote = amount_base ×
 * rate`); the arithmetic is integer throughout, so this and the database never differ in the last
 * minor unit (pinned by `supabase/probes/fx_rounding_parity.sql`'s vectors).
 */
export function quoteConversionMinor(input: {
	toMinor: number;
	fromRate: string | number;
	toRate: string | number;
	fromExponent: number;
	toExponent: number;
	spreadBp: number;
}): ConversionCharge {
	const principal =
		(BigInt(input.toMinor) * parseFixedRate(input.fromRate) * 10n ** BigInt(input.fromExponent)) /
		(parseFixedRate(input.toRate) * 10n ** BigInt(input.toExponent));
	const spread = (principal * BigInt(Math.max(Math.trunc(input.spreadBp), 0))) / 10_000n;
	return {
		principalMinor: Number(principal),
		spreadMinor: Number(spread),
		fromMinor: Number(principal + spread),
	};
}

/**
 * What a refund of `refundMinor` of an escrow of `escrowMinor` returns to a payer it cost `sourceMinor`
 * of their own currency (Decision #435 (D)) — the mirror of `finance.fn_fx_refund_minor`: a whole
 * refund returns exactly what was paid, a part its share rounded up, never more than was paid.
 */
export function pinnedRefundMinor(
	refundMinor: number,
	escrowMinor: number,
	sourceMinor: number,
): number {
	if (refundMinor <= 0 || escrowMinor <= 0 || sourceMinor <= 0) return 0;
	if (refundMinor >= escrowMinor) return sourceMinor;
	const share = (BigInt(refundMinor) * BigInt(sourceMinor) + BigInt(escrowMinor) - 1n) /
		BigInt(escrowMinor);
	return Math.min(sourceMinor, Number(share));
}
// #endregion

// #region Dev override (Decision #436)
/**
 * The Dev Context Switcher's paying-in-one's-own-currency position (`fxCheckout`): `on` or `off` in
 * place of the database's `fx_checkout_enabled`; absent = no override. `off` only refuses its sender,
 * so the database honours it from any caller; `on` loosens the gate, so it counts only in a database
 * whose own `dev_overrides_honoured` is set, which only the local seed world sets
 * (`finance.fn_fx_checkout_enabled`). Sent only by a development build.
 */
export const FxCheckoutOverride = z.enum(["on", "off"]);
export type FxCheckoutOverride = z.infer<typeof FxCheckoutOverride>;

/** The cookie that carries {@link FxCheckoutOverride} from the browser to the server. */
export const FX_CHECKOUT_OVERRIDE_COOKIE = "pj.dev.fx-checkout";

/** The request header that carries it from the server to PostgREST (`finance.fn_dev_fx_checkout`). */
export const FX_CHECKOUT_OVERRIDE_HEADER = "x-pj-dev-fx-checkout";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parseFxCheckoutOverride(raw: string | null | undefined): FxCheckoutOverride | null {
	const parsed = FxCheckoutOverride.safeParse(raw?.trim());
	return parsed.success ? parsed.data : null;
}
// #endregion
