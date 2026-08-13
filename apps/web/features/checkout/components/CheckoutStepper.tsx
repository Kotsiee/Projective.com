import type { JSX } from "preact";
import {
	CHECKOUT_STEPS,
	type CheckoutStep,
	checkoutStepHref,
	checkoutStepIndex,
} from "../core/basket-model.ts";

/**
 * CheckoutStepper — the four-step trail in the middle-nav header band:
 * `Basket › Details › Payment › Confirmation`.
 *
 * **A row of real anchors, rendered on the server, with no client JS.** The URL already holds which
 * step the buyer is on, so the component reads it as a prop and needs no state; the `@projective/ui`
 * `Steps` island was not used for exactly that reason — it is a *controlled* widget bound to an
 * `activeIndex` signal with click activation, which would put a second copy of the current step in
 * the client and give the browser's Back button nothing to move through. It also cannot express an
 * href, so every step would be a JS-only jump.
 *
 * ## The visual language is the design's, not the build brief's
 *
 * The brief specified numbered markers, a check glyph on completed steps and a 2px `--primary`
 * underline on the active one. The design shows something quieter and this follows the design: plain
 * labels separated by a chevron, with the active step carried by **ink and weight alone**. Two
 * consequences worth stating rather than leaving to be discovered:
 *
 * - Weight is doing real work here, not decoration. It is the non-colour channel that keeps the
 *   active step distinguishable under the colour-vision overlays, since the underline that used to
 *   provide one is gone. `aria-current="step"` carries it for assistive tech either way.
 * - The chevrons are `::before` pseudo-elements on every item but the first. A pseudo-element has no
 *   accessible node, so the trail speaks as four items rather than as four items and three
 *   punctuation marks.
 *
 * ## Three states, and only one of them is a link
 *
 * - **Complete** — behind the buyer, and navigable, because going back to change something is the
 *   normal reason a stepper exists. Slightly brighter than upcoming so the trail reads as progress.
 * - **Active** — `aria-current="step"`, full `--on-surface` ink at semibold.
 * - **Upcoming** — rendered as a `<span>`, **not** a disabled anchor: a disabled anchor is still
 *   focusable, still in the tab order and still activatable by Enter in several engines, so it would
 *   offer a path that then refuses. Absence of a link is the honest form.
 *
 * **After the purchase the whole trail freezes.** On the confirmation step nothing behind it is
 * navigable — the basket those steps referred to has become an order, so "back to Payment" would
 * offer to pay for it again. They still render as complete, because they were.
 */

// #region Props
/** Props for {@link CheckoutStepper}. */
export interface CheckoutStepperProps {
	/** The step the URL addresses. */
	active: CheckoutStep;
	/** Carried through every step link so the flow stays on one basket. */
	basketId: string | null;
	/** The acting owner scope (`personal` · `team:northwind` · …). */
	owner: string;
	/** The completed order, on the confirmation step; `null` elsewhere. */
	orderId?: string | null;
	/**
	 * How far the buyer has actually got. A step beyond this is `upcoming` even when it sits before
	 * {@link active} in the list — which happens exactly once, and legitimately: a buyer whose details
	 * were already saved is redirected past Details, and Details must still read as reachable rather
	 * than as a step they skipped by accident.
	 */
	reached?: CheckoutStep;
}
// #endregion

/** One step's rendered state. */
type StepState = "complete" | "active" | "upcoming";

export function CheckoutStepper(props: CheckoutStepperProps): JSX.Element {
	const activeIndex = checkoutStepIndex(props.active);
	const reachedIndex = Math.max(
		activeIndex,
		props.reached ? checkoutStepIndex(props.reached) : activeIndex,
	);
	// Once an order exists the trail is a record, not a route. Nothing behind confirmation is
	// navigable, because the basket those steps addressed no longer exists to be paid for.
	const frozen = props.active === "confirmation";

	return (
		<nav class="cko-stepper" aria-label="Checkout progress">
			<ol class="cko-stepper__list">
				{CHECKOUT_STEPS.map((entry, index) => {
					const state: StepState = index === activeIndex
						? "active"
						: index < activeIndex || index <= reachedIndex
						? "complete"
						: "upcoming";
					const navigable = state === "complete" && !frozen;

					return (
						<li class="cko-stepper__item" key={entry.step} data-state={state}>
							{navigable
								? (
									<a
										class="cko-stepper__step"
										href={checkoutStepHref(
											entry.step,
											props.basketId,
											props.owner,
											undefined,
											props.orderId,
										)}
									>
										{entry.label}
										<span class="ui-visually-hidden">, completed</span>
									</a>
								)
								: (
									<span
										class="cko-stepper__step"
										aria-current={state === "active" ? "step" : undefined}
									>
										{entry.label}
										{
											/* The state is carried by ink and weight, neither of which a screen
											   reader perceives. `aria-current` covers the active step; these two
											   spans are the only way the other two states are spoken. */
										}
										{state === "complete"
											? <span class="ui-visually-hidden">, completed</span>
											: null}
										{state === "upcoming"
											? <span class="ui-visually-hidden">, not yet reached</span>
											: null}
									</span>
								)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
