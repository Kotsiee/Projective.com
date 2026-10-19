/**
 * @projective/ui/fields — MoneyInput's pure parse / format, in minor units.
 *
 * A typed amount is read in the viewer's locale (its own group and decimal separators, so `1.234,5`
 * is one thousand two hundred and thirty-four euros fifty in de-DE) and turned into integer minor
 * units by string arithmetic, never by `major * 100`, which drifts (`1.005 * 100 = 100.4999…`). The
 * formatter is the inverse, so `parse(format(x)) === x` in every locale.
 */
import { currencyExponent } from "../../display/core/currency-store.ts";

// #region Locale
/** A locale's separators for plain numbers. */
export interface NumberSeparators {
	group: string;
	decimal: string;
}

/** The group and decimal separators `locale` prints. */
export function numberSeparators(locale: string): NumberSeparators {
	const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
	return {
		group: parts.find((p) => p.type === "group")?.value ?? ",",
		decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
	};
}

/** Where a currency's mark sits in `locale` ("£12" → start, "12 €" → end), and what it is. */
export interface CurrencyAdornment {
	symbol: string;
	position: "start" | "end";
}

/** The currency mark `locale` prints for `currency`, and on which side. */
export function currencyAdornment(currency: string, locale: string): CurrencyAdornment {
	const code = currency.toUpperCase();
	try {
		const parts = new Intl.NumberFormat(locale, {
			style: "currency",
			currency: code,
			currencyDisplay: "narrowSymbol",
		}).formatToParts(1);
		const at = parts.findIndex((p) => p.type === "currency");
		const integer = parts.findIndex((p) => p.type === "integer");
		return {
			symbol: at >= 0 ? parts[at].value : code,
			position: at >= 0 && integer >= 0 && at > integer ? "end" : "start",
		};
	} catch {
		return { symbol: code, position: "start" };
	}
}
// #endregion

// #region Parse & format
const SPACES = /[\s   ]/g;

/**
 * What a reader typed as integer minor units, or `null` for "nothing yet" / unreadable. Currency
 * marks and spaces are ignored; the locale's group separator is dropped and its decimal separator
 * read as the point. Extra fraction digits round half away from zero at the currency's exponent.
 */
export function parseMoneyInput(text: string, currency: string, locale: string): number | null {
	const { group, decimal } = numberSeparators(locale);
	const exp = currencyExponent(currency);
	let t = text.replace(/[−–]/g, "-").replace(SPACES, "");
	if (group.trim() !== "") t = t.split(group).join("");
	if (decimal !== ".") t = t.split(decimal).join(".");
	t = t.replace(/[^0-9.\-]/g, "");
	const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
	if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
	const negative = m[1] === "-";
	const whole = m[2] === "" ? "0" : m[2];
	const frac = m[3] ?? "";
	const kept = frac.slice(0, exp).padEnd(exp, "0");
	const next = frac.length > exp ? Number(frac[exp]) : 0;
	let minor = Number(whole) * 10 ** exp + (exp > 0 ? Number(kept) : 0);
	if (next >= 5) minor += 1;
	if (!Number.isSafeInteger(minor)) return null;
	return negative && minor !== 0 ? -minor : minor;
}

/**
 * Minor units as the field shows them at rest: the currency's own decimals, no mark, grouped by the
 * locale's OWN rule — the `Intl` default, the one a `MoneyView` of the same amount is formatted with.
 * Forcing grouping (`useGrouping: true` is "always") printed "1 000,00" in the box over a figure that
 * pt-PT, es-ES and pl-PL write "1000,00", since those locales group only from five integer digits.
 */
export function formatMoneyInput(minor: number, currency: string, locale: string): string {
	const exp = currencyExponent(currency);
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: exp,
		maximumFractionDigits: exp,
	}).format(minor / 10 ** exp);
}

/** Clamp minor units into `[min, max]`; an undefined bound is no bound. */
export function clampMinor(minor: number, min?: number, max?: number): number {
	if (min !== undefined && minor < min) return min;
	if (max !== undefined && minor > max) return max;
	return minor;
}
// #endregion
