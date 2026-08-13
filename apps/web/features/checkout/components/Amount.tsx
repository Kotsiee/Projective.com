import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { type MoneySize, MoneyView } from "@projective/ui/display/money";
import type { MoneyView as MoneyViewValue } from "../types/checkout-types.ts";

/**
 * Amount — the single way a server-computed money figure reaches the screen on the checkout surfaces.
 *
 * ## Why this delegates rather than rendering
 *
 * It used to print `value.display` itself and emit only a `data-currency` attribute. That was a
 * **correctness bug, not a style choice.** The app's currency bridge re-projects server-rendered
 * figures by selecting `[data-money]:not([data-money-live])` and rewriting the `.ui-money__amount`
 * child inside each match (`currency-state.ts`, CLAUDE.md Decision #69). A figure carrying neither
 * the attribute nor the child is invisible to that sweep — so when a buyer changed currency, every
 * price, subtotal, fee and grand total on the checkout kept the old one, on the very number they
 * were about to pay, while the header and Explore updated around them.
 *
 * Delegating to `MoneyView` fixes it at the root: the figure emits its own immutable origin
 * (`data-money-minor` / `data-money-currency`), so a re-projection always converts the ORIGINAL
 * amount rather than converting a conversion, and instances inside a hydrated island flag themselves
 * `data-money-live` and re-render through the signal instead of being swept.
 *
 * ## What survives
 *
 * The checkout's own type scale and tones, as a wrapper class. `MoneyView` owns the string; this
 * component owns how big it is and what it means in this surface's vocabulary — a `muted` figure is
 * one the buyer is **not** being charged, and `struck` is a superseded price, neither of which is a
 * concept the shared component has or should have.
 *
 * The one thing deliberately dropped is the major/minor split (`splitMinor`). It parsed a
 * server-formatted string to set the pence a step down, and it cannot survive a client re-projection
 * that replaces that string wholesale. Correct arithmetic beats a typographic nicety.
 *
 * The import is the NARROW `@projective/ui/display/money` sub-path: the `display` barrel re-exports
 * Table, Tree, Galleria and GMap, and pulling those into a route bundle to render a price is exactly
 * what that sub-path exists to prevent.
 */

// #region Props
/** Props for {@link Amount}. */
export interface AmountProps {
	/** The server-computed figure. Its `display` string is what the server said; its origin is what it was priced in. */
	value: MoneyViewValue;
	/**
	 * Type scale. `hero` is the payable total, `lead` a block subtotal, `body` a line price, `micro`
	 * a struck-through or supporting figure.
	 */
	size?: "hero" | "lead" | "body" | "micro";
	/** Semantic tone. `muted` is a figure the buyer is NOT being charged (a disclosure line). */
	tone?: "default" | "muted" | "credit" | "struck";
	/** A leading `−`/`+`. Presentational only — the server sends unsigned amounts with a direction. */
	sign?: "+" | "−" | null;
	/** Overrides the spoken form. `MoneyView` already speaks the conversion; use only to add context. */
	srLabel?: string;
	/** Suppress the origin disclosure — for a dense block that discloses once in its own header. */
	hideOrigin?: boolean;
	/**
	 * Stack the origin disclosure BELOW the converted figure instead of trailing it inline.
	 *
	 * Purely a CSS switch: `MoneyView` already emits the amount and the origin as two flex children of
	 * one wrapper, so this reverses that wrapper's direction and needs no second markup path — which is
	 * what keeps the currency bridge's re-projection (which rebuilds exactly that subtree) working
	 * unchanged.
	 *
	 * Used where a figure closes a block and has room to breathe: the converted amount is what the
	 * buyer will be charged and takes the reading line, with the price the seller actually set beneath
	 * it. Neither is a formula — the rate and the multiplication stay out of the visible form and live
	 * only in the accessible label, because a buyer cannot check arithmetic they were not given the
	 * inputs to.
	 */
	stacked?: boolean;
	class?: string;
}
// #endregion

/**
 * The checkout's four steps onto `MoneyView`'s five.
 *
 * `lead` maps to `key` rather than `figure`: a block subtotal sits beside body text, and `figure` is
 * the shared component's plate-headline step, which would out-shout the payable total two rows below.
 */
const SIZE: Record<NonNullable<AmountProps["size"]>, MoneySize> = {
	hero: "hero",
	lead: "key",
	body: "body",
	micro: "micro",
};

/** Render one server-formatted amount, live to the viewer's display currency. */
export function Amount(props: AmountProps): JSX.Element {
	const { value, size = "body", tone = "default", sign = null, srLabel } = props;

	return (
		<span
			class={cx(
				"cko-money",
				`cko-money--${size}`,
				`cko-money--${tone}`,
				props.stacked && "cko-money--stacked",
				props.class,
			)}
			// `struck` is a checkout concept (a superseded price), so the strike is drawn here rather
			// than pushed into the shared component's tone vocabulary.
			data-struck={tone === "struck" ? "true" : undefined}
		>
			<MoneyView
				value={value}
				size={SIZE[size]}
				// `struck` and `muted` are both "not what you are being charged"; `credit` is a real
				// direction the shared component already models.
				tone={tone === "credit" ? "credit" : tone === "default" ? "default" : "muted"}
				sign={sign}
				hideOrigin={props.hideOrigin}
			/>
			{srLabel ? <span class="ui-visually-hidden">{srLabel}</span> : null}
		</span>
	);
}
