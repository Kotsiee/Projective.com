import type { CheckoutSettlement, FxRateTable, MoneyView } from "@projective/types/finance";
import {
	convertMinorUnits,
	currencyExponent,
	DEFAULT_LOCALE,
	DISPLAY_CURRENCIES,
	formatMoney,
	PLATFORM_BASE_CURRENCY,
	resolveRate,
} from "@projective/types/finance";
import { FxService } from "./FxService.ts";

/**
 * commerce-money — the one money projector every basket, checkout and order figure goes through.
 *
 * A basket line is stored in the currency its listing was priced in; a buyer reads it in their own.
 * That conversion is a READ-TIME projection (Decision #69), and this module is the only place the
 * commerce read path performs it. It resolves the rate table ONCE per read and converts every figure
 * against that one table synchronously, so a checkout that prices forty lines cannot quote two of
 * them at two different rates — the failure a buyer has no way to detect.
 *
 * Two kinds of figure, deliberately told apart:
 *
 * - A **price** was SET in some currency. Converted into the display currency, it carries its
 *   origin and the exact multiplier applied, so the surface can disclose both.
 * - A **derived** figure — a line total, a subtotal, a fee — is computed FROM already-converted
 *   minors and is therefore already in the display currency. It carries no origin: an origin is a
 *   property of a price, not of a sum of several. Summing converted minors (rather than converting a
 *   sum) is also what keeps `Σ lineTotal === subtotal − creatorDiscounts` exact to the minor unit.
 *
 * **An unresolvable pair is never guessed.** If a stored currency cannot be converted into the
 * requested display currency the projector says so (`canConvert`), and the basket read picks a
 * currency every line CAN be shown in instead — a total that silently added dollars to pounds would
 * be a wrong number, which is worse than a number in the "wrong" currency.
 */

// #region Projector
/** A money projector bound to one display currency and one rate table. */
export interface MoneyProjector {
	/** The currency every figure this projector returns is expressed in. */
	display: string;
	/** Whether a stored currency can be expressed in {@link display} at all. */
	canConvert(currency: string): boolean;
	/** A stored minor-unit amount, converted into {@link display} (rounded once, exponent-aware). */
	convertMinor(minor: number, currency: string): number;
	/** A stored PRICE as a {@link MoneyView}, carrying its origin when a conversion happened. */
	price(minor: number, currency: string): MoneyView;
	/** A DERIVED figure already in {@link display}. */
	derived(minor: number): MoneyView;
	/** What a checkout settles in and the observation behind its rate (see {@link settlementFor}). */
	settlementFor(prices: readonly MoneyView[]): CheckoutSettlement;
}

/** Normalise a currency code; `""` stays `""` so a caller can tell "absent" apart. */
function code(value: string | null | undefined): string {
	return (value ?? "").trim().toUpperCase();
}

/**
 * Build a projector for `display`.
 *
 * Async only because the rate table is: once it is in hand every conversion is synchronous, so a
 * read resolves it once at the top and hands the projector down.
 */
export async function moneyProjector(display: string): Promise<MoneyProjector> {
	const table = await FxService.rates(PLATFORM_BASE_CURRENCY);
	return projectorFor(code(display) || PLATFORM_BASE_CURRENCY, table);
}

/** The synchronous projector over an already-resolved table. Exported for tests. */
export function projectorFor(display: string, table: FxRateTable): MoneyProjector {
	const target = code(display);

	const rateFor = (currency: string): number | null => {
		const from = code(currency);
		if (!from) return null;
		if (from === target) return 1;
		return resolveRate(table, from, target);
	};

	const convertMinor = (minor: number, currency: string): number => {
		const from = code(currency);
		const rate = rateFor(from);
		if (rate === null || from === target) return Math.trunc(minor);
		return convertMinorUnits(
			Math.trunc(minor),
			rate,
			currencyExponent(from),
			currencyExponent(target),
		);
	};

	const derived = (minor: number): MoneyView => ({
		minor,
		currency: target,
		display: formatMoney(minor, target, DEFAULT_LOCALE),
		origin: null,
	});

	return {
		display: target,
		canConvert: (currency) => rateFor(currency) !== null,
		convertMinor,
		derived,
		price(minor, currency) {
			const from = code(currency) || target;
			if (from === target) return derived(Math.trunc(minor));
			const rate = rateFor(from);
			// Unreachable when the caller checked `canConvert` first; kept honest regardless — an
			// unconvertible price is shown in its OWN currency, never relabelled.
			if (rate === null) {
				return {
					minor: Math.trunc(minor),
					currency: from,
					display: formatMoney(Math.trunc(minor), from, DEFAULT_LOCALE),
					origin: null,
				};
			}
			const converted = convertMinor(minor, from);
			return {
				minor: converted,
				currency: target,
				display: formatMoney(converted, target, DEFAULT_LOCALE),
				origin: {
					minor: Math.trunc(minor),
					currency: from,
					display: formatMoney(Math.trunc(minor), from, DEFAULT_LOCALE),
					fxRate: rate,
				},
			};
		},
		settlementFor: (prices) => settlementOf(prices, target, table),
	};
}
// #endregion

// #region Settlement
/** `13 Aug 2026 23:38 UTC` — the FX observation instant, stated in UTC so it is unambiguous. */
function utcStamp(isoInstant: string): string {
	const ms = Date.parse(isoInstant);
	if (!Number.isFinite(ms)) return isoInstant.slice(0, 80);
	return `${
		new Intl.DateTimeFormat(DEFAULT_LOCALE, {
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZone: "UTC",
		}).format(new Date(ms)).replace(",", "")
	} UTC`.slice(0, 80);
}

/**
 * What a checkout settles in, and the FX observation behind it.
 *
 * **The rate is READ OFF the prices that were actually converted, never resolved again** — reprinting
 * the multiplier a price carries is the only way the rate the buyer is shown and the figure they are
 * charged cannot disagree. Every FX field is `null` when nothing was converted: on a same-currency
 * checkout there is no rate to quote, and printing one would assert a conversion that never happened.
 */
function settlementOf(
	prices: readonly MoneyView[],
	display: string,
	table: FxRateTable,
): CheckoutSettlement {
	const symbol = DISPLAY_CURRENCIES.find((entry) => entry.code === display)?.symbol ?? display;
	const base: CheckoutSettlement = {
		currency: display,
		symbol,
		label: symbol === display ? display : `${display} (${symbol})`,
		fxRate: null,
		fxBase: null,
		fxAsOf: null,
		rateLabel: null,
		asOfLabel: null,
		originCurrency: null,
	};

	const converted = prices.find((price) => price.origin !== null)?.origin ?? null;
	if (converted === null || code(converted.currency) === display) return base;

	const rate = Math.round(converted.fxRate * 10_000) / 10_000;
	return {
		...base,
		fxRate: rate,
		fxBase: table.base,
		fxAsOf: table.asOf,
		rateLabel: `1 ${code(converted.currency)} = ${rate} ${display}`.slice(0, 80),
		asOfLabel: utcStamp(table.asOf),
		originCurrency: code(converted.currency),
	};
}
// #endregion
