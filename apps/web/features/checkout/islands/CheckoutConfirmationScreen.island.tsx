import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/checkout.css";
import "../styles/checkout-confirmation.css";
import { Icon } from "@projective/ui/icons";
import { basketHref, checkoutStepHref } from "../core/basket-model.ts";
import { markReached, orderPage, seedStep } from "../core/checkout-state.ts";
import { OrderSummaryHeader } from "../components/OrderSummaryHeader.tsx";
import { OrderLineRow } from "../components/OrderLineRow.tsx";
import { OrderInvoicePanel } from "../components/OrderInvoicePanel.tsx";
import { Amount } from "../components/Amount.tsx";
import type { OrderPage } from "../types/checkout-types.ts";

/**
 * CheckoutConfirmationScreen — the `/checkout/confirmation` BODY: step 4, the post-purchase hub.
 *
 * Three things govern this surface.
 *
 * 1. **It is a GET over a read projection, never a re-POST.** The order already exists; the page
 *    reads it. Re-submitting `create()` from here would be a second charge attempt in a flow whose
 *    idempotency ledger is a process-local map with no TTL — it would replay correctly in
 *    development and double-charge behind more than one instance.
 * 2. **No order is an EMPTY STATE, never a redirect.** A buyer who has just paid and is bounced to
 *    another page reads the bounce as the payment having vanished. The page says what it looked for,
 *    says explicitly that nothing about their order has changed, and offers the way back — which is
 *    a link, so it is theirs to take rather than something done to them.
 * 3. **It runs in FULL chrome.** The sidebar and the lane come back, because the whole job of this
 *    step is to send the buyer somewhere: a download, a project channel, a calendar, an invoice.
 *    Stripping the exits from the page that exists to be an exit would defeat it.
 *
 * **Nothing here computes money.** Every figure is a server-computed `MoneyView` rendered through
 * {@link Amount}, which delegates to the shared `MoneyView` component so each figure carries its own
 * immutable origin and re-projects correctly when the viewer changes display currency.
 *
 * The island owns the empty branch as well as the populated one, deliberately: a stylesheet reaches
 * a page only through an ISLAND's client bundle, so a server-rendered empty state would ship
 * unstyled on exactly the branch a confused buyer is looking at.
 */

// #region Props
/** Props for {@link CheckoutConfirmationScreen}. */
export interface CheckoutConfirmationScreenProps {
	/**
	 * The SSR-resolved order page, or `null` when the account has no order to show.
	 *
	 * Nullable at the prop rather than behind a route redirect — see rule 2 in the module note.
	 */
	initial: OrderPage | null;
}
// #endregion

export default function CheckoutConfirmationScreen(
	props: CheckoutConfirmationScreenProps,
): JSX.Element {
	const { initial } = props;

	// The four regions of a step are four hydration roots, so the body publishes what it is showing
	// rather than passing it. `markReached` is separate from `seedStep`: reaching confirmation is what
	// makes the stepper's final anchor navigable, and it must not be undone by walking back.
	useEffect(() => {
		seedStep("confirmation");
		if (initial) markReached("confirmation");
		orderPage.value = initial;
	}, [initial]);

	if (!initial) return <EmptyOrder />;

	const { order, recent } = initial;
	const others = recent.filter((entry) => entry.id !== order.id);

	return (
		<div class="cko-order">
			<OrderSummaryHeader order={order} />

			<section class="cko-order__section" aria-labelledby="cko-order-lines-head">
				<h3 class="cko-order__head" id="cko-order-lines-head">What you bought</h3>
				<ul class="cko-order__lines">
					{order.lines.map((line) => <OrderLineRow key={line.id} line={line} />)}
				</ul>
			</section>

			{order.invoice
				? <OrderInvoicePanel invoice={order.invoice} currency={order.currency} />
				: (
					<p class="cko-order__prose">
						No invoice has been raised for this order yet. When one is, it appears here and in your
						wallet's invoice history.
					</p>
				)}

			{others.length > 0
				? (
					<section class="cko-order__section" aria-labelledby="cko-order-recent-head">
						<h3 class="cko-order__head" id="cko-order-recent-head">Your recent orders</h3>
						<ul class="cko-order__recent">
							{others.map((entry) => (
								<li key={entry.id} class="cko-order__recentitem">
									<a
										class="cko-order__recentlink"
										href={checkoutStepHref(
											"confirmation",
											null,
											null,
											undefined,
											entry.id,
										)}
									>
										{entry.reference}
									</a>
									<span class="cko-order__recentmeta">{entry.placedAtLabel}</span>
									<Amount value={entry.total} size="micro" tone="muted" />
								</li>
							))}
						</ul>
					</section>
				)
				: null}
		</div>
	);
}

// #region Empty state
/**
 * No order resolved for this account.
 *
 * The copy is deliberately careful about what it does and does not know. It cannot say "nothing was
 * charged" — this page has no visibility of a charge it could not find. What it CAN say truthfully is
 * that failing to display an order neither creates nor cancels one, and that the reference is in the
 * confirmation email. Anything stronger would be a reassurance the surface cannot back.
 */
function EmptyOrder(): JSX.Element {
	return (
		<div class="cko-order">
			<section class="cko-order__empty" aria-labelledby="cko-order-empty-head">
				<span class="cko-order__emptymark" aria-hidden="true">
					<Icon name="basket" size="md" />
				</span>

				<h2 class="cko-order__title" id="cko-order-empty-head">
					There's no order to show here yet
				</h2>

				<p class="cko-order__prose">
					We couldn't find a recent order on this account. If you have just paid, give it a moment
					and reload — this page failing to find an order does not change one, and your confirmation
					email carries the reference either way.
				</p>

				<a class="cko-order__act" href={basketHref()}>
					<Icon name="arrow-left" optical="left" />
					<span>Back to your basket</span>
				</a>
			</section>
		</div>
	);
}
// #endregion
