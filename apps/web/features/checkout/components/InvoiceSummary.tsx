import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { feeDisclosure } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import type { AppliedPromo, CheckoutTotals } from "../types/checkout-types.ts";

/**
 * InvoiceSummary — the itemised arithmetic, exactly as the server computed it.
 *
 * Every figure is a `MoneyView` printed by its `display` string. Nothing here adds, subtracts,
 * discounts, converts or rounds: the whole point of `CheckoutTotals` carrying seven separate amounts
 * is that the surface never has to derive the eighth.
 *
 * **The platform fee is the one line that can be presented dishonestly**, so it gets the only branch
 * in this component. Under the platform's documented default the fee comes out of the seller's
 * release, and showing it as an added line would overstate what the buyer pays by exactly the fee.
 * The branch lives in {@link feeDisclosure}; here it decides the row's data attribute, its note, and
 * whether the amount reads as a charge or as disclosure.
 *
 * The block is a polite live region: a promo landing or a line being deselected changes what the
 * buyer will be charged, and a total that changes silently is a total nobody re-reads.
 */

// #region Props
/** Props for {@link InvoiceSummary}. */
export interface InvoiceSummaryProps {
	totals: CheckoutTotals;
	/** The promo attached to the basket, valid or refused; `null` when none is applied. */
	promo: AppliedPromo | null;
	/** How many lines this payment covers — a count, never money. */
	lineCount: number;
	/** DOM id, so a `price_changed` refusal can point the buyer straight at the new total. */
	id?: string;
}
// #endregion

/** Render the invoice breakdown. */
export function InvoiceSummary(props: InvoiceSummaryProps): JSX.Element {
	const { totals, promo, lineCount, id = "cko-summary" } = props;
	const fee = feeDisclosure(totals);
	const hasTaxLine = totals.taxes.minor > 0 || totals.taxNote !== null;

	return (
		<section
			class="cko-sum"
			id={id}
			role="status"
			aria-live="polite"
			aria-labelledby="cko-sum-head"
		>
			<h2 class="cko-sum__head" id="cko-sum-head">
				What you'll pay
				<span class="cko-sum__count">
					{lineCount} {lineCount === 1 ? "item" : "items"}
				</span>
			</h2>

			<dl class="cko-sum__rows">
				<div class="cko-sum__row">
					<dt class="cko-sum__label">Subtotal</dt>
					<dd class="cko-sum__value">
						<Amount value={totals.subtotal} />
					</dd>
				</div>

				{totals.creatorDiscounts.minor > 0 && (
					<div class="cko-sum__row" data-kind="discount">
						<dt class="cko-sum__label">Seller discounts</dt>
						<dd class="cko-sum__value">
							<Amount value={totals.creatorDiscounts} tone="credit" sign="−" />
						</dd>
					</div>
				)}

				{promo?.valid && (
					<div class="cko-sum__row" data-kind="discount">
						<dt class="cko-sum__label">{promo.label}</dt>
						<dd class="cko-sum__value">
							<Amount value={totals.promoDiscount} tone="credit" sign="−" />
						</dd>
					</div>
				)}

				{
					/*
					 * The fee. `data-charged` is what the stylesheet reads to keep a disclosure figure from
					 * looking like a charge, and the note says the same thing in words — a colour alone has
					 * never told anyone who is paying a fee.
					 */
				}
				<div class="cko-sum__row" data-kind="fee" data-charged={fee.charged ? "true" : "false"}>
					<dt class="cko-sum__label">
						{fee.label}
						<span class="cko-sum__note">{fee.note}</span>
					</dt>
					<dd class="cko-sum__value">
						<Amount
							value={totals.platformFee}
							tone={fee.charged ? "default" : "muted"}
							srLabel={fee.charged
								? undefined
								: `${totals.platformFee.display}, paid by the seller, not added to your total`}
						/>
					</dd>
				</div>

				{hasTaxLine
					? (
						<div class="cko-sum__row" data-kind="tax">
							<dt class="cko-sum__label">
								Tax
								{totals.taxNote && <span class="cko-sum__note">{totals.taxNote}</span>}
							</dt>
							<dd class="cko-sum__value">
								<Amount value={totals.taxes} />
							</dd>
						</div>
					)
					: (
						/*
						 * No tax engine has determined anything for this order, so nothing is asserted about
						 * one. A "Tax £0.00" row would claim a determination that has not been made, and a
						 * "tax may apply later" line would promise one this surface cannot make either.
						 */
						<p class="cko-sum__aside">No tax has been applied to this order.</p>
					)}
			</dl>

			<p class="cko-sum__total">
				<span class="cko-sum__total-label">Total</span>
				<Amount value={totals.total} size="hero" />
			</p>

			{!fee.charged && (
				<p class="cko-sum__disclosure">
					<Icon name="info" />
					<span>
						The {fee.label.toLowerCase()}{" "}
						above is shown so you can see the full picture of the transaction. It comes out of the
						seller's earnings and is not part of your total.
					</span>
				</p>
			)}

			{promo && !promo.valid && (
				<p class="cko-sum__promo-error" role="status">
					<Icon name="warning" />
					<span>{promo.message ?? `“${promo.code}” could not be applied.`}</span>
				</p>
			)}
		</section>
	);
}
