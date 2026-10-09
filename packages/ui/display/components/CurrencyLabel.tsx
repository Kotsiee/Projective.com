import type { JSX } from "preact";
import "../styles/currency-label.css";
import { cx } from "../../core/cx.ts";
import { Flag, type FlagSize } from "./Flag.tsx";

// #region Shapes
/**
 * One currency as the picker family draws it. Plain data, so any catalogue can be passed in — the
 * package owns how a currency LOOKS, never which currencies exist.
 */
export interface CurrencyChoice {
	/** ISO 4217 code (`USD`). */
	code: string;
	/** The display symbol (`$`). Never used to format an amount. */
	symbol: string;
	/** The currency's name (`US Dollar`) — the accessible name and a filter term. */
	label: string;
	/** ISO 3166-1 alpha-2 of the issuing country, or `EU`. */
	country: string;
	/** The issuing country's name (`United States`). */
	countryName: string;
}

/** Props for {@link CurrencyLabel}. */
export interface CurrencyLabelProps {
	currency: CurrencyChoice;
	/** Flag diameter (default `md`, the two-line row's height). */
	flagSize?: FlagSize;
	class?: string;
}
// #endregion

/** `$ USD`, or just `CHF` when the symbol IS the code. */
export function currencyHeadline(currency: CurrencyChoice): string {
	const symbol = currency.symbol.trim();
	return symbol && symbol.toUpperCase() !== currency.code.toUpperCase()
		? `${symbol} ${currency.code}`
		: currency.code;
}

/**
 * CurrencyLabel — the one way a currency is drawn wherever it is chosen (DESIGN_SYSTEM §C.1): a
 * circular flag, then `[symbol] [code]` over the issuing country's name in the meta register. The
 * same shape fills a `CurrencySelect` trigger, each of its options and any hand-built currency list,
 * so a currency reads the same on every surface. The flag is decorative; the text names it.
 */
export function CurrencyLabel(
	{ currency, flagSize = "md", class: className }: CurrencyLabelProps,
): JSX.Element {
	return (
		<span class={cx("ui-currency", className)}>
			<Flag code={currency.country} size={flagSize} />
			<span class="ui-currency__text">
				<span class="ui-currency__code">{currencyHeadline(currency)}</span>
				<span class="ui-currency__country">{currency.countryName}</span>
			</span>
		</span>
	);
}
