import type { JSX } from "preact";
import "../styles/checkout.css";
import "../styles/checkout-confirmation.css";
import "../styles/checkout-orders.css";
import { itemKindMeta } from "@projective/types/finance";
import { Icon } from "@projective/ui/icons";
import { MetaLine } from "@projective/ui/display";
import { basketHref, checkoutStepHref, ordersHref } from "../core/basket-model.ts";
import { Amount } from "../components/Amount.tsx";
import type { OrderHistoryEntry, OrderHistoryPage, OrderStatus } from "../types/checkout-types.ts";

/**
 * CheckoutOrdersScreen — the `/checkout/orders` BODY: every past order of the acting account, newest
 * first, twenty to a page (MARKETPLACE CK3).
 *
 * **Everything here is a link; nothing here is state.** The owner switch, each receipt and the pager
 * are anchors whose hrefs come from `basket-model`'s builders, so every view of the history is a URL a
 * buyer can bookmark or be sent, and Back walks the pages. The page boundaries are the server's opaque
 * tokens, carried and never built.
 *
 * **A history row reprints the receipt.** Its figures are server-formatted `MoneyView`s through
 * {@link Amount}; its facts are MetaLine text. Each line links to its home (the purchases view, the
 * session's workspace, the project) and a delivered product to its review (`reviewHref`, the review
 * dialog on the purchases view), and each order opens its full receipt on the confirmation view.
 */

// #region Props
/** Props for {@link CheckoutOrdersScreen}. */
export interface CheckoutOrdersScreenProps {
	/** The SSR-resolved page, or `null` when the read failed (an unreachable state, not an empty one). */
	initial: OrderHistoryPage | null;
}
// #endregion

// #region Copy
const STATUS_LABEL: Record<OrderStatus, string> = {
	confirmed: "Paid",
	processing: "Processing",
	awaiting_payment: "Awaiting payment",
	invoiced: "Invoiced",
	refunded: "Refunded",
	cancelled: "Cancelled",
};

function itemsLabel(count: number): string {
	return count === 1 ? "1 item" : `${count} items`;
}
// #endregion

export default function CheckoutOrdersScreen(props: CheckoutOrdersScreenProps): JSX.Element {
	const { initial } = props;
	if (!initial) return <Unreachable />;

	const { ownerKey, entries, older, newer } = initial;
	const owners = initial.owners.length > 1 ? initial.owners : [];

	return (
		<div class="cko-orders">
			<header class="cko-orders__header">
				<h2 class="cko-orders__title">Orders</h2>
				<MetaLine
					items={[initial.ownerName, entries.length > 0 && "Newest first"]}
				/>
				{owners.length > 0
					? (
						<nav aria-label="Whose orders">
							<ul class="cko-orders__owners">
								{owners.map((owner) => (
									<li key={owner.key}>
										<a
											class="cko-orders__owner"
											href={ordersHref(owner.key)}
											aria-current={owner.key === ownerKey ? "page" : undefined}
										>
											{owner.name}
										</a>
									</li>
								))}
							</ul>
						</nav>
					)
					: null}
			</header>

			{entries.length === 0 && !newer
				? <NoOrders owner={ownerKey} name={initial.ownerName} />
				: (
					<ol class="cko-orders__list" aria-label={`Orders for ${initial.ownerName}`}>
						{entries.map((entry) => <OrderEntry key={entry.id} entry={entry} owner={ownerKey} />)}
					</ol>
				)}

			{older || newer
				? (
					<nav class="cko-orders__pager" aria-label="Order pages">
						{newer
							? (
								<a class="cko-order__act" href={ordersHref(ownerKey, { before: newer })}>
									<Icon name="arrow-left" optical="left" />
									<span>Newer orders</span>
								</a>
							)
							: null}
						{older
							? (
								<a
									class="cko-order__act cko-orders__pagerend"
									href={ordersHref(ownerKey, { after: older })}
								>
									<span>Older orders</span>
									<Icon name="arrow-right" optical="right" />
								</a>
							)
							: null}
					</nav>
				)
				: null}
		</div>
	);
}

// #region Entry
/** One past order: its reference opens the receipt, and each line links to where it lives now. */
function OrderEntry({ entry, owner }: { entry: OrderHistoryEntry; owner: string }): JSX.Element {
	const receipt = checkoutStepHref("confirmation", null, owner, undefined, entry.id);
	return (
		<li class="cko-orders__entry">
			<div class="cko-orders__entryhead">
				<a
					class="cko-orders__ref"
					href={receipt}
					aria-label={`Order ${entry.reference}, open the receipt`}
				>
					{entry.reference}
				</a>
				<span class="cko-orders__total">
					<Amount value={entry.total} />
				</span>
				<MetaLine
					class="cko-orders__meta"
					size="xs"
					items={[
						{ text: entry.placedAtLabel, tabular: true },
						STATUS_LABEL[entry.status],
						{ text: itemsLabel(entry.lines.length), tabular: true },
					]}
				/>
			</div>

			{entry.lines.length > 0
				? (
					<ul class="cko-orders__lines">
						{entry.lines.map((line) => (
							<li key={line.id} class="cko-orders__line">
								<div class="cko-orders__linebody">
									<p class="cko-orders__linetitle">{line.title}</p>
									<MetaLine size="xs" items={[itemKindMeta(line.itemType).label]} />
									{line.home || line.reviewHref
										? (
											<span class="cko-orders__links">
												{line.home
													? (
														<a class="cko-orders__home" href={line.home.href}>
															{line.home.label}
														</a>
													)
													: null}
												{line.reviewHref
													? (
														<a
															class="cko-orders__review"
															href={line.reviewHref}
															aria-label={`Review ${line.title}`}
														>
															Review
														</a>
													)
													: null}
											</span>
										)
										: null}
								</div>
								<span class="cko-orders__lineprice">
									<Amount value={line.lineTotal} size="micro" tone="muted" />
								</span>
							</li>
						))}
					</ul>
				)
				: null}
		</li>
	);
}
// #endregion

// #region Empty and unreachable
/** The account has no orders: an honest empty place, with the way to start one. */
function NoOrders({ owner, name }: { owner: string; name: string }): JSX.Element {
	return (
		<section class="cko-orders__empty" aria-labelledby="cko-orders-empty-head">
			<h3 class="cko-orders__emptyhead" id="cko-orders-empty-head">No orders yet</h3>
			<p class="cko-orders__prose">
				{`Nothing has been bought as ${name} yet. Every order placed from this account appears here, newest first.`}
			</p>
			<a class="cko-order__act" href={basketHref(null, owner)}>
				<Icon name="basket" />
				<span>Go to your basket</span>
			</a>
		</section>
	);
}

/** The read failed. Saying "no orders" here would tell a buyer their purchases are gone. */
function Unreachable(): JSX.Element {
	return (
		<div class="cko-orders">
			<section class="cko-orders__empty" aria-labelledby="cko-orders-down-head">
				<h3 class="cko-orders__emptyhead" id="cko-orders-down-head">
					We couldn't load your orders
				</h3>
				<p class="cko-orders__prose">
					Nothing about your orders has changed. Reload the page in a moment, or open a receipt from
					its confirmation email.
				</p>
			</section>
		</div>
	);
}
// #endregion
