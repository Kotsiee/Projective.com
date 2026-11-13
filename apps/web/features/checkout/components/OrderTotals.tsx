import type { JSX } from "preact";
import { feeDisclosure } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import type { CheckoutSessionContext } from "../types/checkout-types.ts";

/** Props for {@link OrderTotals}. */
export interface OrderTotalsProps {
	/** The live server projection — the source of every figure. */
	view: Pick<CheckoutSessionContext, "totals" | "promo" | "charge" | "currency" | "settlement">;
	/** The block's element id — where a `price_changed` refusal points. */
	id?: string;
}

/**
 * OrderTotals — an order's arithmetic and its payable total, the ONE block the checkout rail and Buy
 * now both print, so the two can never answer the same session differently. It computes nothing:
 * every figure is a server `MoneyView` printed through {@link Amount}. When the charge is in another
 * currency than the total is read in, the exact charge is stated under it (Decision #153).
 */
export function OrderTotals(props: OrderTotalsProps): JSX.Element {
	const { view, id = "cko-summary" } = props;
	const { totals } = view;
	const fee = feeDisclosure(totals);
	const hasTax = totals.taxes.minor > 0 || totals.taxNote !== null;
	/*
	 * The contribution row appears exactly when the SERVER has actually added one to the total, so it
	 * can neither show a £0.00 "Processing fee" while a recomputed session is in flight nor disagree with
	 * the Order Total beneath it.
	 */
	const showsContribution = totals.processingContribution.minor > 0;
	const charge = view.charge;
	const converted = charge !== null && charge.currency !== view.currency;

	return (
		<div class="cko-rail__totals" id={id} role="status" aria-live="polite">
			<dl class="cko-rail__rows">
				<div class="cko-rail__row">
					<dt class="cko-rail__label">Items</dt>
					<dd class="cko-rail__value">
						<Amount value={totals.subtotal} hideOrigin />
					</dd>
				</div>

				{totals.creatorDiscounts.minor > 0 && (
					<div class="cko-rail__row" data-kind="discount">
						<dt class="cko-rail__label">Seller discounts</dt>
						<dd class="cko-rail__value">
							<Amount value={totals.creatorDiscounts} tone="credit" sign="−" hideOrigin />
						</dd>
					</div>
				)}

				{view.promo?.valid && (
					<div class="cko-rail__row" data-kind="discount">
						<dt class="cko-rail__label">{view.promo.label}</dt>
						<dd class="cko-rail__value">
							<Amount value={totals.promoDiscount} tone="credit" sign="−" hideOrigin />
						</dd>
					</div>
				)}

				{
					/*
					 * The one line that can be presented dishonestly. Under the platform's documented default the
					 * fee comes out of the seller's release, so showing it as an addition would overstate what the
					 * buyer pays by exactly the fee. `feeDisclosure` owns the branch.
					 */
				}
				<div class="cko-rail__row" data-kind="fee" data-charged={fee.charged ? "true" : "false"}>
					<dt class="cko-rail__label">
						{fee.label}
						<span class="cko-rail__note">{fee.note}</span>
					</dt>
					<dd class="cko-rail__value">
						<Amount
							value={totals.platformFee}
							tone={fee.charged ? "default" : "muted"}
							hideOrigin
							srLabel={fee.charged
								? undefined
								: `${totals.platformFee.display}, paid by the seller, not added to your total`}
						/>
					</dd>
				</div>

				{hasTax && (
					<div class="cko-rail__row" data-kind="tax">
						<dt class="cko-rail__label">
							Tax
							{totals.taxNote && <span class="cko-rail__note">{totals.taxNote}</span>}
						</dt>
						<dd class="cko-rail__value">
							<Amount value={totals.taxes} hideOrigin />
						</dd>
					</div>
				)}

				{showsContribution && (
					<div class="cko-rail__row" data-kind="contribution">
						<dt class="cko-rail__label">Processing fee</dt>
						<dd class="cko-rail__value">
							<Amount value={totals.processingContribution} hideOrigin />
						</dd>
					</div>
				)}
			</dl>

			{
				/*
				 * The payable figure with its ISO code: "$" alone is eight of the platform's currencies, and this
				 * is the number the buyer authorises. The code is `aria-hidden` because `MoneyView` already speaks
				 * the full amount including its currency.
				 */
			}
			<p class="cko-rail__grand">
				<span class="cko-rail__grand-label">Order Total</span>
				<span class="cko-rail__grand-figure">
					<Amount value={totals.total} size="hero" />
					<span class="cko-rail__grand-code" aria-hidden="true">
						{view.settlement.currency}
					</span>
				</span>
			</p>

			{
				/*
				 * The dual display (Decision #153): a card or express payment is charged in the currency the
				 * sellers priced in, so when that is not the buyer's currency the exact charge is stated under
				 * the total — `(~US$229.00 USD charged)` — `pinned` so it prints in its own currency. The
				 * accessible sentence says which side is exact.
				 */
			}
			{converted && charge && (
				<p class="cko-rail__charge">
					<span class="ui-visually-hidden">
						{`Your card or wallet is charged exactly ${charge.display} ${charge.currency}; the ${view.currency} total above is an estimate.`}
					</span>
					<span class="cko-rail__charge-figure" aria-hidden="true">
						(~<Amount value={charge} size="body" hideOrigin pinned /> {charge.currency} charged)
					</span>
					{view.settlement.rateLabel && (
						<span class="cko-rail__charge-rate">
							{view.settlement.rateLabel}
							{view.settlement.asOfLabel ? ` · locked ${view.settlement.asOfLabel}` : ""}. Your bank
							converts the charge at its own rate.
						</span>
					)}
				</p>
			)}
		</div>
	);
}
