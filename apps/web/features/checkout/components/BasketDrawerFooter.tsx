import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import { basketHref } from "../core/basket-model.ts";
import { Amount } from "./Amount.tsx";
import type { AppliedPromo, Basket } from "../types/checkout-types.ts";

/** Props for {@link BasketDrawerFooter}. */
export interface BasketDrawerFooterProps {
	basket: Basket;
	/** The open owner scope key, carried into both destinations. */
	ownerParam: string;
	promo: AppliedPromo | null;
	/** Close the drawer before a destination opens. */
	onClose: () => void;
}

/**
 * BasketDrawerFooter — the basket drawer's pinned `footer` slot (§B.10.8): Subtotal, Creator discounts
 * when there are any, and Total before fees, every figure the server's `MoneyView` through
 * {@link Amount} in `tabular-nums`; a valid promo is a note below, never a third deduction (`net`
 * excludes it by definition). Then **View all baskets** — tier 4, the neutral outlined utility on the
 * standard radius — and **Proceed to Checkout**, the tier-1 commit pill (§B.8.1, §B.8.4), which opens
 * step 1 of `/checkout` and is disabled, with the reason said, while nothing is ticked.
 */
export function BasketDrawerFooter(props: BasketDrawerFooterProps): JSX.Element {
	const { basket, ownerParam, promo, onClose } = props;
	const nothingTicked = basket.selectedCount === 0;
	const hasPromo = promo?.valid === true && promo.amount.minor > 0;

	return (
		<div class="bskd__foot">
			<dl class="bskd__totals">
				<div class="bskd__total-row">
					<dt>Subtotal</dt>
					<dd>
						<Amount value={basket.subtotal} hideOrigin />
					</dd>
				</div>
				{basket.creatorDiscounts.minor > 0
					? (
						<div class="bskd__total-row">
							<dt>Creator discounts</dt>
							<dd>
								<Amount value={basket.creatorDiscounts} sign="−" tone="credit" hideOrigin />
							</dd>
						</div>
					)
					: null}
				<div class="bskd__total-row bskd__total-row--net">
					<dt>Total before fees</dt>
					<dd>
						<Amount value={basket.net} size="lead" />
					</dd>
				</div>
			</dl>
			{hasPromo
				? (
					<p class="bskd__note">
						{promo.label} takes a further <Amount value={promo.amount} tone="credit" hideOrigin />
						{" "}
						off at checkout.
					</p>
				)
				: null}

			<div class="bskd__ctas">
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md bskd__cta"
					href={basketHref(null, ownerParam)}
					onClick={onClose}
				>
					<span class="ui-button__icon">
						<Icon name="basket" size="sm" />
					</span>
					<span class="ui-button__label">View all baskets</span>
				</a>
				<Button
					severity="accent"
					variant="filled"
					rounded
					disabled={nothingTicked}
					aria-describedby={nothingTicked ? "bskd-proceed-why" : undefined}
					icon={<Icon name="wallet" size="sm" />}
					label="Proceed to Checkout"
					onClick={() => {
						onClose();
						globalThis.location.href = basketHref(basket.id, ownerParam);
					}}
				/>
			</div>
			{nothingTicked
				? (
					<p class="bskd__note" id="bskd-proceed-why" role="status">
						Nothing is ticked. Tick at least one item to take it through to checkout.
					</p>
				)
				: null}
		</div>
	);
}
