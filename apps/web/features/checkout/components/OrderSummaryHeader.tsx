import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import type { Order, OrderStatus } from "../types/checkout-types.ts";

/**
 * OrderSummaryHeader — the confirmation hub's opening statement: what happened, to which order, when,
 * how it was paid, and — when a conversion applied — at which rate.
 *
 * **Nothing here is computed.** `charged` is a server-formatted `MoneyView`; `placedAtLabel`,
 * `rateLabel` and `asOfLabel` are server-formatted strings. A rate composed on the client would be a
 * second record of a conversion the ledger already committed, and an invoice that disagrees with its
 * own transaction is the single failure this money contract exists to prevent.
 *
 * **The FX snapshot is reprinted, never recalculated.** `order.invoice.fx` carries the rate that was
 * COMMITTED at the moment of the charge, not today's — reading a live rate here would silently
 * restate what the buyer paid every time they reopened the page. There are exactly three facts and
 * never a fourth: origin, converted, rate with its stamp. The spread and any conversion fee are an
 * open platform decision, and a slot for a number nobody has decided is how a fabricated figure ends
 * up on a receipt.
 *
 * **Separation is rung 2** (§B.4): a tonal tint against the page, no border. The banner is content to
 * be read, and a four-sided outline would claim it is something to operate.
 */

// #region Status vocabulary
/** How one order status presents: its glyph, its headline, and the tone the banner adopts. */
interface StatusPresentation {
	icon: IconName;
	title: string;
	/** The short word the decorative mark's tooltip-free pill carries; the heading states it in full. */
	badge: string;
}

/**
 * The presentation for each status.
 *
 * A `Record` rather than a `switch`, so a status added to the SSOT enum fails the type-check here
 * instead of falling through to a default that quietly renders "confirmed" over a refund.
 */
const STATUS: Record<OrderStatus, StatusPresentation> = {
	confirmed: { icon: "success", title: "Your order is confirmed", badge: "Confirmed" },
	processing: { icon: "clock", title: "Your order is being processed", badge: "Processing" },
	awaiting_payment: {
		icon: "hourglass",
		title: "Waiting on your payment provider",
		badge: "Awaiting payment",
	},
	invoiced: { icon: "document", title: "Added to your monthly invoice", badge: "Invoiced" },
	refunded: { icon: "refresh", title: "This order was refunded", badge: "Refunded" },
	cancelled: { icon: "close", title: "This order was cancelled", badge: "Cancelled" },
};
// #endregion

// #region Props
/** Props for {@link OrderSummaryHeader}. */
export interface OrderSummaryHeaderProps {
	/** The completed order, exactly as the server projected it. */
	order: Order;
	/** DOM id for the heading, so the hub's landmark can be labelled by it. */
	headingId?: string;
}
// #endregion

/** Render the order's success banner. */
export function OrderSummaryHeader(props: OrderSummaryHeaderProps): JSX.Element {
	const { order, headingId = "cko-order-head" } = props;
	const presentation = STATUS[order.status];
	const fx = order.invoice?.fx ?? null;
	const contributed = order.processingContribution.minor > 0;

	return (
		<header class="cko-order__banner" data-status={order.status}>
			<div class="cko-order__statusrow">
				{
					/* The glyph is decorative: the heading immediately beneath states the same fact in
				    words, and announcing it twice is noise rather than redundancy. */
				}
				<span class="cko-order__mark" aria-hidden="true">
					<Icon name={presentation.icon} size="md" />
				</span>
				<span class="cko-order__factlabel">{presentation.badge}</span>
			</div>

			<h2 class="cko-order__title" id={headingId}>{presentation.title}</h2>

			{order.message ? <p class="cko-order__message">{order.message}</p> : null}

			<dl class="cko-order__facts">
				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Order reference</dt>
					<dd class="cko-order__factvalue">
						<span class="cko-order__ref">{order.reference}</span>
					</dd>
				</div>

				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Placed</dt>
					<dd class="cko-order__factvalue">
						<time dateTime={order.placedAt}>{order.placedAtLabel}</time>
					</dd>
				</div>

				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Paid with</dt>
					<dd class="cko-order__factvalue">{order.paymentMethodLabel}</dd>
				</div>

				<div class="cko-order__fact">
					<dt class="cko-order__factlabel">Charged</dt>
					<dd class="cko-order__factvalue">
						<Amount value={order.charged} size="hero" />
					</dd>
				</div>
			</dl>

			{contributed
				? (
					<p class="cko-order__note">
						<Icon name="info" />
						<span>
							Includes your voluntary contribution of{" "}
							<Amount value={order.processingContribution} size="micro" />{" "}
							toward card processing costs. Thank you.
						</span>
					</p>
				)
				: null}

			{fx
				? (
					<p class="cko-order__fx">
						<Icon name="info" />
						<span>
							Priced in {fx.originCurrency}, charged in {fx.chargedCurrency} at {fx.rateLabel}{" "}
							— the rate applied at{" "}
							{fx.asOfLabel}. This is the rate recorded against the payment, not today's.
						</span>
					</p>
				)
				: null}

			{order.pendingCount > 0
				? (
					<p class="cko-order__note">
						<Icon name="hourglass" />
						<span>
							{order.pendingCount === 1
								? "One item is still waiting on a step before it can start."
								: `${order.pendingCount} items are still waiting on a step before they can start.`}
							{" "}
							Each one says what it is waiting for below.
						</span>
					</p>
				)
				: null}
		</header>
	);
}
