import type { JSX } from "preact";
import { Amount } from "./Amount.tsx";
import type { AppliedPromo, Basket } from "../types/checkout-types.ts";

/**
 * BasketTotals — what the selected lines come to, printed verbatim.
 *
 * Every figure is a server-computed `MoneyView` rendered through the shared {@link Amount}. Nothing is
 * summed, discounted, converted or formatted here, and the two discount layers stay two named lines
 * rather than one unexplained delta — a buyer who cannot see WHERE a saving came from cannot tell a
 * creator's price cut from a code they applied, and will read either as an error.
 *
 * Reading a basket's total is VIEWING, which is why the block belongs in the body. The control that
 * acts on it — Checkout, carrying the same figure — lives in the footer band, per the region contract.
 *
 * The closing note is not filler: `net` is the last figure this surface can state honestly. The
 * platform fee and any tax are resolved against the payment route the buyer has not chosen yet, so
 * promising a final number here would be a figure the checkout then contradicts.
 *
 * **A valid promo is deliberately NOT a row in the deduction list**, and that is a correction rather
 * than an omission. The SSOT defines `net` as `subtotal − creatorDiscounts` — explicitly the figure
 * "a promo code and the fee are then applied against" — so the promo lands in `CheckoutTotals`, one
 * step later. Listing it here as a third deduction produced a column that visibly did not add up
 * (measured: subtotal £1,380.32, creator −£14.17, promo −£273.23, total £1,366.15), which is worse
 * than a wrong number: it is a correct number arranged to look like an error. The promo instead
 * appears below the total as what it actually is — a saving that applies at the next step.
 */

// #region Props
/** Props for {@link BasketTotals}. */
export interface BasketTotalsProps {
	/** The open basket, carrying every server-computed figure. */
	basket: Basket;
	/** The promo attached to it, valid or refused. */
	promo: AppliedPromo | null;
}
// #endregion

export function BasketTotals(props: BasketTotalsProps): JSX.Element {
	const { basket, promo } = props;
	const hasCreatorDiscount = basket.creatorDiscounts.minor > 0;
	const hasPromo = promo?.valid === true && promo.amount.minor > 0;

	return (
		<section class="bsk-totals" aria-labelledby="bsk-totals-head">
			<h2 class="bsk-totals__head" id="bsk-totals-head">
				Selected total
				<span class="bsk-totals__count">
					{basket.selectedCount} of {basket.itemCount} lines
				</span>
			</h2>

			<dl class="bsk-totals__list">
				<div class="bsk-totals__row">
					<dt>Subtotal</dt>
					<dd>
						<Amount value={basket.subtotal} />
					</dd>
				</div>

				{hasCreatorDiscount && (
					<div class="bsk-totals__row" data-saving="true">
						<dt>Creator discounts</dt>
						<dd>
							<Amount
								value={basket.creatorDiscounts}
								sign="−"
								tone="credit"
								srLabel={`Minus ${basket.creatorDiscounts.display}`}
							/>
						</dd>
					</div>
				)}

				<div class="bsk-totals__row bsk-totals__row--net">
					<dt>Total before fees</dt>
					<dd>
						<Amount value={basket.net} size="lead" />
					</dd>
				</div>
			</dl>

			{hasPromo && (
				<p class="bsk-totals__pending">
					<span class="bsk-totals__pending-label">{promo.label}</span>
					{" takes a further "}
					<Amount value={promo.amount} tone="credit" />
					{" off at checkout."}
				</p>
			)}

			<p class="bsk-totals__note">
				The platform fee and any tax are worked out at checkout, once you have chosen how to pay.
			</p>
		</section>
	);
}
