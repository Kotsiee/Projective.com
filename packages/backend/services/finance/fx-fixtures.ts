import { PLATFORM_BASE_CURRENCY } from "@projective/types/finance";

/**
 * fx-fixtures — the stub rate table {@link FxService} answers from while `FINANCE_BACKEND_LIVE` is
 * off, and the last-resort floor it falls back to when the live read fails.
 *
 * These numbers are **the same observations seeded into `finance.fx_rates`**
 * (`00005050_seed_reference_data.sql`, `provider = 'seed'`, the same fixed `as_of`) — deliberately,
 * not coincidentally. A stub table that disagreed with the seeded database would mean a figure
 * changes the moment the gate is flipped, and "the price moved because we turned a flag on" is the
 * single worst thing a currency layer can do. The two lists are kept in step by hand; the fixed
 * `as_of` makes any divergence visible rather than silent, because a mismatched pair would surface
 * as two different `asOf` values on the same figure.
 *
 * `as_of` is a FIXED instant, never `Date.now()` — every sibling read projection in this package
 * derives from a fixed reference clock so SSR is deterministic and a snapshot is reproducible.
 */

/** The reference instant every seeded observation is quoted at. Matches the SQL seed exactly. */
export const FX_FIXTURE_AS_OF = "2026-08-01T00:00:00.000Z";

/** The provider slug marking a rate as seeded reference data rather than a live observation. */
export const FX_FIXTURE_PROVIDER = "seed";

/**
 * Multipliers FROM the platform base (`GBP`) INTO each quote — `amount_quote = amount_gbp × rate`.
 * The base's own entry is present and exactly `1`, so `resolveRate` never special-cases it.
 */
export const FX_FIXTURE_RATES: Readonly<Record<string, number>> = Object.freeze({
	GBP: 1,
	USD: 1.27,
	EUR: 1.17,
	CAD: 1.73,
	AUD: 1.93,
	JPY: 192,
	INR: 106,
	SGD: 1.7,
	CHF: 1.12,
	ZAR: 23.1,
	NGN: 1980,
	AED: 4.66,
});

/** The base every fixture rate is quoted against. */
export const FX_FIXTURE_BASE = PLATFORM_BASE_CURRENCY;
