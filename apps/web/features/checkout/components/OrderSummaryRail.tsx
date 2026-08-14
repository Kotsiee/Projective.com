import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import { itemKindMeta } from "@projective/types/finance";
import { Icon } from "@projective/ui/icons";
import { itemKindLabel } from "../core/basket-model.ts";
import { feeDisclosure } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import { ProcessingContribution } from "./ProcessingContribution.tsx";
import { groupIconName } from "./checkout-glyphs.tsx";
import type {
	BasketItem,
	CheckoutSessionContext,
	ProcessingContributionOffer,
} from "../types/checkout-types.ts";

/**
 * OrderSummaryRail — the order summary, and the ONLY one on the flow.
 *
 * ## One component, because two rails is two answers
 *
 * The Details step and the Payment step used to draw their own summaries — `.ckod-rail` and
 * `.cko-rail` — with different markup, different type scales, different row sets and two independent
 * decisions about which of the intermediate lines to show. They were describing the same basket and
 * the same arithmetic, so the only thing two implementations could ever produce was a discrepancy the
 * buyer would find on the step where it mattered most. This is that one implementation; both steps
 * mount it inside the same `.cko-pstep__aside`, so the rail's width, padding, tone, sticky offset and
 * scroll behaviour are literally the same rule rather than two rules kept in agreement by hand.
 *
 * ## What it is, top to bottom
 *
 * 1. **Your Basket** — the lines this payment covers, and the only region that scrolls.
 * 2. **The voluntary contribution** — payment step only; the Details step has not yet chosen a route,
 *    and an offer that depends on one would be answering a question nobody has asked.
 * 3. **The breakdown and the Order Total** — every figure a server-computed `MoneyView`.
 * 4. **The commit region** — whatever the step passes: Continue on Details, Express + Buy Now on
 *    Payment.
 *
 * **The address, the billing identity and the chosen instrument are deliberately NOT here.** They
 * moved to the Contract Banner at the top of the payment step's main column, where they sit beside
 * the decision they inform instead of pushing the total and its button below the fold.
 *
 * ## Rules this rail keeps
 *
 * **It computes nothing.** Every figure arrives as a server-computed `MoneyView` and is printed
 * through {@link Amount}; there is no sum, no fee, no conversion and no rounding here. That is also
 * why opting into the contribution re-reads the session rather than adding to a total client-side.
 *
 * **Separation is spacing, a tonal ground and at most one hairline (§B.4).** Nothing here is boxed:
 * the only interactive things in it are the contribution checkbox and whatever the commit slot
 * carries, and each of those draws its own outline.
 *
 * **Nothing animates a property that encodes data.** No figure is transitioned into place, so a
 * frozen animation clock in a background tab can never leave an amount stating something untrue.
 */

// #region Line details
/**
 * The one detail line beneath a basket row: WHICH instance of the purchasable this is.
 *
 * A session's booked slot, a ticket's routed stage and a product's licence are the same fact at this
 * scale, so one resolution order covers all three and falls back to the kind's own noun rather than
 * to an empty row. Both halves are strings the server already formatted — nothing is derived.
 *
 * **It carries no price.** The row shows exactly one figure, the line total, which is what the buyer
 * is charged for that line. A per-unit price beside it was a second money figure for the same row,
 * and a reader who cannot see the multiplication cannot check it — so the quantity is stated in words
 * and the money is stated once.
 */
function detailOf(item: BasketItem): string {
	const base = item.scheduledLabel ?? item.stageLabel ?? item.subtitle ?? itemKindLabel(item);
	const seats = item.seats !== null && item.seats > 1 ? ` · ${item.seats} seats` : "";
	return `${base}${seats}`;
}
// #endregion

// #region Props
/** Props for {@link OrderSummaryRail}. */
export interface OrderSummaryRailProps {
	/** The live server projection — the source of every line and every figure. */
	view: CheckoutSessionContext;
	/** The lines this payment covers, already narrowed to what is included. */
	items: readonly BasketItem[];
	/**
	 * The voluntary gateway-contribution offer, or `null` to omit the block entirely.
	 *
	 * `null` is the Details step: no route has been chosen there, and the offer only exists once one
	 * has been (a wallet payment touches no card scheme, so there is no third-party cost to help with).
	 * Rendering it a step early would ask the buyer to answer for a payment method they have not picked.
	 */
	contribution: ProcessingContributionOffer | null;
	/** Controlled opt-in for the contribution. Unread when {@link contribution} is `null`. */
	optedIn: Signal<boolean>;
	/** Whether a session read is in flight, so the contribution cannot be toggled mid-recompute. */
	reading: boolean;
	onToggleContribution: (next: boolean) => void;
	/** Where the buyer edits the basket — the step before this one. */
	basketHref: string;
	/** The step's commitment, and anything that shares its region (the express block, a reassurance). */
	children: ComponentChildren;
}
// #endregion

/** The composition, the arithmetic, and the step's commitment. */
export function OrderSummaryRail(props: OrderSummaryRailProps): JSX.Element {
	const { view, items } = props;
	const { totals } = view;

	const fee = feeDisclosure(totals);
	const hasTax = totals.taxes.minor > 0 || totals.taxNote !== null;
	/*
	 * The contribution row appears exactly when the SERVER has actually added one to the total.
	 *
	 * Keyed on the figure rather than on the checkbox for two reasons. It cannot show a £0.00
	 * "Processing fee" in the window between a tick and the recomputed session landing — a row that
	 * says the buyer is paying nothing for something is worse than no row. And it cannot disagree with
	 * the Order Total beneath it, because it is reading the same number that total was computed from.
	 * Unticked, the server adds nothing and the row is absent entirely.
	 */
	const showsContribution = totals.processingContribution.minor > 0;

	return (
		<section class="cko-rail" aria-labelledby="cko-rail-head">
			<div class="cko-rail__headrow">
				<h2 class="cko-rail__head" id="cko-rail-head">Your Basket</h2>
				<a class="cko-rail__change" href={props.basketHref}>Change</a>
			</div>

			{
				/*
				 * The ONE region of the rail that scrolls.
				 *
				 * A long basket must not push the Order Total and the commit off the bottom of a rail that
				 * is pinned to the viewport — so the lines take the rail's spare height and scroll inside
				 * it, and the arithmetic and the button below stay on screen at every basket length. It is
				 * a real scroll container, so it is focusable and keyboard-scrollable (`tabIndex={0}` with
				 * a group role and a name), which is what stops a keyboard-only reader from being unable to
				 * reach the lines at all.
				 */
			}
			<div
				class="cko-rail__sec"
				role="group"
				aria-labelledby="cko-rail-head"
				tabIndex={0}
			>
				{items.length === 0
					? (
						<p class="cko-rail__empty" role="status">
							Nothing is selected for this payment yet.
						</p>
					)
					: (
						<ul class="cko-rail__items">
							{items.map((item) => (
								<li key={item.id} class="cko-rail__item">
									<span class="cko-rail__thumb" aria-hidden="true">
										{item.thumbnail
											? (
												<img
													class="cko-rail__thumbimg"
													src={item.thumbnail}
													alt=""
													loading="lazy"
												/>
											)
											: <Icon name={groupIconName(itemKindMeta(item.itemType).group)} />}
									</span>

									<span class="cko-rail__itembody">
										<span class="cko-rail__itemtitle">{item.title}</span>
										<span class="cko-rail__itemmeta">
											<span class="cko-rail__slotlabel">{detailOf(item)}</span>
											{
												/*
												 * The quantity is stated only when there IS one to state. A line of one
												 * needs no multiplier, and the platform's purchasables are overwhelmingly
												 * single-quantity — but a corpus line that genuinely carries two must not
												 * show one price with no explanation of what it covers.
												 */
											}
											{item.quantity > 1 && (
												<span class="cko-rail__qty">{`× ${item.quantity}`}</span>
											)}
										</span>
									</span>

									{/* The line's ONE figure: what this line costs. */}
									<span class="cko-rail__linetotal">
										<Amount value={item.lineTotal} size="body" hideOrigin />
									</span>
								</li>
							))}
						</ul>
					)}
			</div>

			{props.contribution && (
				<ProcessingContribution
					offer={props.contribution}
					optedIn={props.optedIn}
					busy={props.reading}
					onToggle={props.onToggleContribution}
				/>
			)}

			{
				/*
				 * The arithmetic, as a polite live region: a promo landing or a contribution being accepted
				 * changes what the buyer will be charged, and a total that changes silently is a total
				 * nobody re-reads. `#cko-summary` is also where a `price_changed` refusal points.
				 */
			}
			<div class="cko-rail__totals" id="cko-summary" role="status" aria-live="polite">
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
						 * The one line that can be presented dishonestly. Under the platform's documented
						 * default the fee comes out of the seller's release, so showing it as an addition
						 * would overstate what the buyer pays by exactly the fee. `feeDisclosure` owns the
						 * branch; the note says in words what the tone says in colour.
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
					 * The payable figure, with its ISO code stated beside it.
					 *
					 * The symbol alone is ambiguous across a dozen currencies that share one — "$" is eight
					 * different currencies on this platform's own offerable list — and this is the number the
					 * buyer authorises. The code is `aria-hidden` because `MoneyView` already speaks the
					 * full amount including its currency, and hearing "GBP" twice is noise.
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
			</div>

			{props.children}
		</section>
	);
}
