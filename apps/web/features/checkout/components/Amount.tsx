import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { splitMinor } from "@features/wallet/core/money-format.ts";
import type { MoneyView } from "../types/checkout-types.ts";

/**
 * Amount — the single way a {@link MoneyView} reaches the screen on the `/basket` + `/checkout`
 * surfaces.
 *
 * It renders the SERVER's `display` string and does nothing else to it: no formatting, no rounding,
 * no currency composition, no conversion. The only transformation is a SPLIT, so the minor units can
 * be set a step down at display sizes without re-composing the string — `Intl` already applied the
 * locale's grouping, symbol position and decimal separator server-side, and re-deriving any of that
 * client-side is how SSR and a hydrated island come to disagree about a price.
 *
 * {@link splitMinor} is imported from the wallet feature rather than copied. It is a pure function
 * over a formatted string, and a second parser of server money strings is precisely the kind of
 * duplicate the money contract exists to prevent — the two would eventually disagree about where the
 * pence begin in some locale, on two surfaces showing the same figure.
 *
 * Deliberately absent: any fee, spread, saving or "you save" element. Those are business questions
 * this surface renders the server's answer to, never a figure a component invents.
 */

// #region Props
/** Props for {@link Amount}. */
export interface AmountProps {
	/** The server-computed figure. Rendered by its `display` string. */
	value: MoneyView;
	/**
	 * Type scale. `hero` is the payable total, `lead` a block subtotal, `body` a line price, `micro`
	 * a struck-through or supporting figure.
	 */
	size?: "hero" | "lead" | "body" | "micro";
	/** Semantic tone. `muted` is a figure the buyer is NOT being charged (a disclosure line). */
	tone?: "default" | "muted" | "credit" | "struck";
	/** A leading `−`/`+`. Presentational only — the server sends unsigned amounts with a direction. */
	sign?: "+" | "−" | null;
	/** Overrides the spoken form. Defaults to the `display` string, which screen readers speak well. */
	srLabel?: string;
	class?: string;
}
// #endregion

/** Render one server-formatted amount. */
export function Amount(props: AmountProps): JSX.Element {
	const { value, size = "body", tone = "default", sign = null, srLabel } = props;
	const parts = splitMinor(value.display, value.currency);

	return (
		<span
			class={cx("cko-money", `cko-money--${size}`, `cko-money--${tone}`, props.class)}
			data-currency={value.currency}
		>
			{
				/*
				 * The sign and the major run are bare text rather than classed spans: they carry no style
				 * of their own, and a class hook with no rule anywhere is a hook the next reader has to
				 * go looking for. Only the two parts that ARE styled — the symbol and the de-emphasised
				 * minor units — get an element.
				 */
			}
			<span class="cko-money__amount" aria-hidden={srLabel ? "true" : undefined}>
				{sign}
				{parts.symbol && <span class="cko-money__symbol">{parts.symbol}</span>}
				{parts.major}
				{parts.minor && <span class="cko-money__minor">{parts.minor}</span>}
				{parts.suffix && <span class="cko-money__symbol">{parts.suffix}</span>}
			</span>
			{srLabel && <span class="ui-visually-hidden">{srLabel}</span>}
		</span>
	);
}
