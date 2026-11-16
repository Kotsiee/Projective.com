import type { JSX } from "preact";
import { Skeleton } from "@projective/ui/feedback";
import { feeDisclosure, listedReference } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import { FxBreakdown } from "./FxBreakdown.tsx";
import type { CheckoutSessionContext } from "../types/checkout-types.ts";

/** Props for {@link OrderTotals}. */
export interface OrderTotalsProps {
	/** The live server projection — the source of every figure. */
	view: Pick<
		CheckoutSessionContext,
		"totals" | "promo" | "buyerCharge" | "originTotals" | "currency" | "settlement"
	>;
	/** The block's element id — where a `price_changed` refusal points. */
	id?: string;
	/**
	 * A recompute is in flight: every figure is a shimmer bar on the figure's own line box, so the rows
	 * keep their geometry and no stale amount is shown while the server answers.
	 */
	pending?: boolean;
}

/** A money figure that is being recomputed: a shimmer bar on the figure's own line box. */
export function PendingAmount(props: { size: "body" | "hero"; width: string }): JSX.Element {
	return (
		<span class={`cko-money cko-money--${props.size} cko-rail__ph`} aria-hidden="true">
			<span class="ui-money__amount">
				<Skeleton shape="text" width={props.width} height="0.75em" animation="shimmer" />
			</span>
		</span>
	);
}

/**
 * OrderTotals — an order's arithmetic and its payable total, the ONE block the checkout rail and Buy
 * now both print, so the two can never answer the same session differently. It computes nothing:
 * every figure is a server `MoneyView` printed through {@link Amount}, in the buyer's currency only.
 * When the charge is in another currency, that currency is named under the total and the exact charge
 * and rate open from its {@link FxBreakdown} (Decisions #153, #433). When it is converted into the
 * buyer's own currency (Decision #435), the disclosed margin and the exact charge follow the total, with
 * what the order is listed at and the locked rate beside it.
 */
export function OrderTotals(props: OrderTotalsProps): JSX.Element {
	const { view, id = "cko-summary", pending = false } = props;
	const { totals } = view;
	const fee = feeDisclosure(totals);
	const hasTax = totals.taxes.minor > 0 || totals.taxNote !== null;
	/*
	 * The contribution row appears exactly when the SERVER has actually added one to the total, so it
	 * can neither show a £0.00 "Processing fee" while a recomputed session is in flight nor disagree with
	 * the Order Total beneath it.
	 */
	const showsContribution = totals.processingContribution.minor > 0;
	const charge = view.buyerCharge;
	const quote = charge?.quote ?? null;
	const reference = listedReference(view);
	const converted = charge !== null && quote === null && charge.currency !== view.currency;

	return (
		<div
			class="cko-rail__totals"
			id={id}
			role="status"
			aria-live="polite"
			aria-busy={pending ? "true" : undefined}
		>
			<dl class="cko-rail__rows">
				<div class="cko-rail__row">
					<dt class="cko-rail__label">Items</dt>
					<dd class="cko-rail__value">
						{pending
							? <PendingAmount size="body" width="4.5rem" />
							: <Amount value={totals.subtotal} hideOrigin />}
					</dd>
				</div>

				{totals.creatorDiscounts.minor > 0 && (
					<div class="cko-rail__row" data-kind="discount">
						<dt class="cko-rail__label">Seller discounts</dt>
						<dd class="cko-rail__value">
							{pending
								? <PendingAmount size="body" width="3.5rem" />
								: <Amount value={totals.creatorDiscounts} tone="credit" sign="−" hideOrigin />}
						</dd>
					</div>
				)}

				{view.promo?.valid && (
					<div class="cko-rail__row" data-kind="discount">
						<dt class="cko-rail__label">{view.promo.label}</dt>
						<dd class="cko-rail__value">
							{pending
								? <PendingAmount size="body" width="3.5rem" />
								: <Amount value={totals.promoDiscount} tone="credit" sign="−" hideOrigin />}
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
						{pending ? <PendingAmount size="body" width="3.5rem" /> : (
							<Amount
								value={totals.platformFee}
								tone={fee.charged ? "default" : "muted"}
								hideOrigin
								srLabel={fee.charged
									? undefined
									: `${totals.platformFee.display}, paid by the seller, not added to your total`}
							/>
						)}
					</dd>
				</div>

				{hasTax && (
					<div class="cko-rail__row" data-kind="tax">
						<dt class="cko-rail__label">
							Tax
							{totals.taxNote && <span class="cko-rail__note">{totals.taxNote}</span>}
						</dt>
						<dd class="cko-rail__value">
							{pending
								? <PendingAmount size="body" width="3.5rem" />
								: <Amount value={totals.taxes} hideOrigin />}
						</dd>
					</div>
				)}

				{showsContribution && (
					<div class="cko-rail__row" data-kind="contribution">
						<dt class="cko-rail__label">Processing fee</dt>
						<dd class="cko-rail__value">
							{pending
								? <PendingAmount size="body" width="3.5rem" />
								: <Amount value={totals.processingContribution} hideOrigin />}
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
			{charge && quote && reference
				? (
					<>
						<dl class="cko-rail__rows cko-rail__pay">
							<div class="cko-rail__row" data-kind="order-total">
								<dt class="cko-rail__label">Order Total</dt>
								<dd class="cko-rail__value">
									{pending
										? <PendingAmount size="body" width="4.5rem" />
										: <Amount value={totals.total} hideOrigin />}
								</dd>
							</div>
							<div class="cko-rail__row" data-kind="margin">
								<dt class="cko-rail__label">{quote.marginLabel}</dt>
								<dd class="cko-rail__value">
									{pending
										? <PendingAmount size="body" width="3.5rem" />
										: <Amount value={quote.margin} exact />}
								</dd>
							</div>
						</dl>
						<p class="cko-rail__grand" data-kind="charge">
							<span class="cko-rail__grand-label">You pay</span>
							<span class="cko-rail__grand-figure">
								{pending
									? <PendingAmount size="hero" width="7rem" />
									: <Amount value={charge} size="hero" exact />}
								<span class="cko-rail__grand-code" aria-hidden="true">{charge.currency}</span>
								<FxBreakdown
									kind="charged"
									exact={charge}
									settlement={view.settlement}
									conversion={{ listed: reference.value, quote }}
									id={`${id}-fx`}
									pending={pending}
								/>
							</span>
						</p>
						{!pending && (
							<p class="cko-rail__listed">
								Listed at {reference.value.display} {reference.value.currency} at{" "}
								{reference.rateLabel}
							</p>
						)}
					</>
				)
				: (
					<>
						<p class="cko-rail__grand">
							<span class="cko-rail__grand-label">Order Total</span>
							<span class="cko-rail__grand-figure">
								{pending
									? <PendingAmount size="hero" width="7rem" />
									: <Amount value={totals.total} size="hero" hideOrigin />}
								<span class="cko-rail__grand-code" aria-hidden="true">
									{view.settlement.currency}
								</span>
							</span>
						</p>

						{
							/*
							 * Decision #433: the charge currency is always named under the total; the exact charge,
							 * the locked rate and the bank caveat sit one press away in the breakdown.
							 */
						}
						{converted && charge && (
							<p class="cko-rail__charge">
								<span class="cko-rail__charge-label">Charged in {charge.currency}</span>
								<FxBreakdown
									kind="charged"
									exact={charge}
									settlement={view.settlement}
									id={`${id}-fx`}
									pending={pending}
								/>
							</p>
						)}
					</>
				)}
		</div>
	);
}
