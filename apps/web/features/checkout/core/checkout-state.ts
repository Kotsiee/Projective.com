import { computed, signal } from "@preact/signals";
import type {
	BasketLists,
	BillingContextKind,
	BuyerDetails,
	CheckoutStep,
	OrderPage,
} from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";

/**
 * checkout-state — the cross-island store for the four-step flow.
 *
 * The four regions of a checkout step (lane · header band · body · footer band) are **four separate
 * hydration roots**: the shell renders them from separate slot resolvers, so they are not in one
 * another's component trees and cannot pass props. Signals are how they agree — the same bridge the
 * board's footer↔body and the wallet's rig↔body already use.
 *
 * It deliberately holds **no money arithmetic and no server projection it computed itself**. Every
 * figure here arrived as a server-computed `MoneyView`; the store's job is to say which step is on
 * screen and what the buyer has chosen, not what anything costs.
 *
 * `basket-state.ts` is untouched and still owns the basket read, the optimistic line layer and the
 * payment composition. This module adds only what the four-step flow introduced.
 */

// #region Step
/** The step currently on screen, seeded from the URL by whichever region mounts first. */
export const activeStep = signal<CheckoutStep>("basket");

/**
 * How far the buyer has actually reached.
 *
 * Distinct from {@link activeStep} for one real case: a buyer whose details were already saved is
 * redirected past Details, and a buyer who then walks BACK to the basket must still see Details and
 * Payment as reachable rather than as steps they have not earned. Monotonic — it never moves
 * backwards, because having been somewhere is not undone by leaving it.
 */
export const reachedStep = signal<CheckoutStep>("basket");

const ORDER: readonly CheckoutStep[] = ["basket", "details", "payment", "confirmation"];

/** Record that a step has been reached, keeping {@link reachedStep} monotonic. */
export function markReached(step: CheckoutStep): void {
	if (ORDER.indexOf(step) > ORDER.indexOf(reachedStep.peek())) reachedStep.value = step;
}

/** Seed the step signals from the URL. Idempotent; safe from every region. */
export function seedStep(step: CheckoutStep): void {
	activeStep.value = step;
	markReached(step);
}
// #endregion

// #region Buyer details (step 2)
/** The server's saved record for the active billing identity; `null` until a region has read one. */
export const buyerDetails = signal<BuyerDetails | null>(null);

/** Which billing identity the Details form is showing. */
export const billingContextKind = signal<BillingContextKind>("personal");

/**
 * Whether the form holds edits the server has not yet accepted.
 *
 * Measured against the record the SERVER last returned, never against the immutable SSR prop — the
 * defect both workspace policy screens shipped, where a successful save left the footer permanently
 * dirty because the baseline could not move (Decision #61).
 */
export const detailsDirty = signal<boolean>(false);
// #endregion

// #region Payment (step 3)
/** Whether the buyer opted into the voluntary gateway contribution. */
export const contributionOptedIn = signal<boolean>(false);
// #endregion

// #region Confirmation (step 4)
/** The completed order, once the confirmation step has read one. */
export const orderPage = signal<OrderPage | null>(null);
// #endregion

// #region Lists (step 1)
/** The lane's navigation model — named lists plus the two engagement-derived groups. */
export const lists = signal<BasketLists | null>(null);

/** The list currently open, so the lane and the body agree on what the body is showing. */
export const activeListId = signal<string | null>(null);

/** The active list's running total, for the lane footer. `null` until a read lands. */
export const activeListTotal = computed<string | null>(() =>
	lists.value?.activeSubtotal.display ?? null
);
// #endregion

// #region Region bridge
/**
 * Fired by a band to ask the body to advance the flow.
 *
 * The footer rig holds the step's commit action (the region contract), but the BODY holds the
 * composition being committed — which lines, which details, which instrument. A rig that assembled
 * its own idea of what was being bought would be a second answer to the same question, and the two
 * would eventually differ by one line.
 */
export const CHECKOUT_STEP_EVENT = "pj:checkout-step";

/** Ask the active step's body to advance. */
export function requestStepAdvance(step: CheckoutStep): void {
	if (typeof globalThis.dispatchEvent !== "function") return;
	globalThis.dispatchEvent(new CustomEvent(CHECKOUT_STEP_EVENT, { detail: { step } }));
}
// #endregion

// #region Read unwrapping
/** The last read error, so a failed refetch is visible rather than silent. */
export const stepError = signal<string | null>(null);

/**
 * Apply a read, or record why it failed.
 *
 * **The `else` is the whole point.** Ten refetches across `/wallet` were written as
 * `if (res.ok && res.data)` with no else, so a failed currency or account switch left the PREVIOUS
 * account's figures on screen indefinitely, indistinguishable from a successful read (Decision #63,
 * defect J). On a checkout that failure mode means showing a buyer a total that is not the one they
 * are about to be charged.
 *
 * Returns whether the read landed, so a caller can decide whether to keep an optimistic change.
 */
export function applyRead<T>(res: CheckoutResponse<T>, apply: (data: T) => void): boolean {
	if (res.ok && res.data) {
		stepError.value = null;
		apply(res.data);
		return true;
	}
	// `message` is optional on the envelope, so a refusal that carried none must still say SOMETHING
	// — a null here would render as no error at all, which is the exact silence this function exists
	// to end.
	stepError.value = res.message ??
		"That didn't load. Nothing has been charged — check your connection and try again.";
	return false;
}
// #endregion
