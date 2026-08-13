import type { ShellChrome } from "@projective/ui/navigation";
import { checkoutStepOf, isCheckoutPath, isFocusStep } from "./basket-model.ts";

/**
 * checkout-chrome — the URL-keyed resolver for the shell's chrome density on a checkout route
 * (mirrors `basketLaneFor` / `basketHeaderFor` / `basketFooterFor`).
 *
 * **Why a resolver and not a page-level flag.** The shell is rendered by the layout, above the route,
 * so a page cannot tell it what to be — the same reason the lane and the two bands are resolved from
 * the URL rather than registered by the page (Decision #28). Resolving it here means the correct
 * chrome ships in the FIRST BYTE: there is no frame in which the sidebar and the lane paint and then
 * disappear, which on a payment page would be a layout jump under the buyer's cursor at the exact
 * moment they are about to click Pay.
 *
 * Pure and total — no state, no DOM, no service. Safe to import from the layout.
 */

/**
 * The chrome a request runs in.
 *
 * `focus` on the two committing steps (`/checkout/details`, `/checkout/payment`) and `full`
 * everywhere else, including the basket step and the confirmation step. The two exclusions are
 * deliberate and are the whole reason this is a function of the STEP rather than of the section:
 *
 * - **The basket keeps its chrome** because it is a place a buyer legitimately leaves — to add one
 *   more thing, to re-read a listing, to check a message. Removing the exits from a page nobody has
 *   committed to would be a trap rather than a focus aid.
 * - **The confirmation restores it** because the whole job of that page is to send the buyer
 *   somewhere: to a download, to a project board, to a calendar. A post-purchase hub with no
 *   navigation is a dead end at the one moment the product has most to offer.
 */
export function checkoutChromeFor(url: URL): ShellChrome | null {
	if (!isCheckoutPath(url.pathname)) return null;
	return isFocusStep(checkoutStepOf(url.pathname)) ? "focus" : "full";
}
