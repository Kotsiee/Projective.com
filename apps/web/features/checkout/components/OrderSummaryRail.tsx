import type { ComponentChildren, JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { OrderLines } from "./OrderLines.tsx";
import { OrderTotals } from "./OrderTotals.tsx";
import { PayInChoice } from "./PayInChoice.tsx";
import { ProcessingContribution } from "./ProcessingContribution.tsx";
import type {
	BasketItem,
	CheckoutSessionContext,
	ProcessingContributionOffer,
} from "../types/checkout-types.ts";

/**
 * OrderSummaryRail — the order summary, and the ONLY one on the flow: the Details and Payment steps
 * both mount it inside `.cko-pstep__aside`, so its width, tone and pinning are one rule.
 *
 * Top to bottom: the lines this payment covers, the voluntary contribution (payment step only — the
 * Details step has chosen no route), the server-computed arithmetic and Order Total, then whatever
 * commit region the step passes.
 *
 * **It never scrolls inside itself.** The page scrolls natively; a basket longer than
 * {@link RAIL_LINES_SHOWN} + 1 lines shows its first {@link RAIL_LINES_SHOWN} and a Show all toggle,
 * so the pinned rail stays short enough to keep its total and commit on screen.
 *
 * **It computes nothing.** Every figure is a server-computed `MoneyView`; opting into the contribution
 * re-reads the session rather than adding to a total here.
 */

/** How many lines the rail lists before the rest wait behind Show all. */
export const RAIL_LINES_SHOWN = 3;

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
	 */
	contribution: ProcessingContributionOffer | null;
	/** Controlled opt-in for the contribution. Unread when {@link contribution} is `null`. */
	optedIn: Signal<boolean>;
	/** Whether a session read is in flight, so the contribution cannot be toggled mid-recompute. */
	reading: boolean;
	onToggleContribution: (next: boolean) => void;
	/** Where the buyer edits the basket — the step before this one. */
	basketHref: string;
	/**
	 * The payment step in each currency the order may be paid in (Decision #435), keyed by currency;
	 * absent or empty offers no choice (the Details step, or nothing to convert).
	 */
	payInHrefs?: Readonly<Record<string, string>>;
	/** The step's commitment, and anything that shares its region. */
	children: ComponentChildren;
}
// #endregion

/** The composition, the arithmetic, and the step's commitment. */
export function OrderSummaryRail(props: OrderSummaryRailProps): JSX.Element {
	const { view, items } = props;
	const expanded = useSignal(false);
	const folds = items.length > RAIL_LINES_SHOWN + 1;
	const shown = folds && !expanded.value ? items.slice(0, RAIL_LINES_SHOWN) : items;

	return (
		<section class="cko-rail" aria-labelledby="cko-rail-head">
			<div class="cko-rail__headrow">
				<h2 class="cko-rail__head" id="cko-rail-head">Your basket</h2>
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ui-button--rounded cko-rail__change"
					href={props.basketHref}
				>
					<span class="ui-button__label">Change</span>
				</a>
			</div>

			<div class="cko-rail__sec" id="cko-rail-lines">
				<OrderLines items={shown} empty="Nothing is selected for this payment yet." />
				{folds && (
					<Button
						class="cko-rail__more"
						severity="neutral"
						variant="outlined"
						size="sm"
						rounded
						icon={<Icon name={expanded.value ? "chevron-up" : "chevron-down"} />}
						label={expanded.value ? "Show fewer" : `Show all ${items.length} items`}
						aria-expanded={expanded.value ? "true" : "false"}
						aria-controls="cko-rail-lines"
						onClick={() => {
							expanded.value = !expanded.value;
						}}
					/>
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

			<OrderTotals view={view} />
			{props.payInHrefs && <PayInChoice payIn={view.payIn} hrefs={props.payInHrefs} />}
			{props.children}
		</section>
	);
}
