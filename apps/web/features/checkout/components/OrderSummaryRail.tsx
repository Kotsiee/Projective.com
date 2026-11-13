import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import { OrderLines } from "./OrderLines.tsx";
import { OrderTotals } from "./OrderTotals.tsx";
import { ProcessingContribution } from "./ProcessingContribution.tsx";
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
				<OrderLines items={items} empty="Nothing is selected for this payment yet." />
			</div>

			{props.contribution && (
				<ProcessingContribution
					offer={props.contribution}
					optedIn={props.optedIn}
					busy={props.reading}
					onToggle={props.onToggleContribution}
				/>
			)}

			<OrderTotals view={view} />
			{props.children}
		</section>
	);
}
