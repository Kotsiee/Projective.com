import type { ListingOffer } from "../types/catalogue-types.ts";
import { draft, edit } from "./workspace-store.ts";
import { deliveryLabel, type OfferProblem, offerProblem, sanitiseOffer } from "./offer-model.ts";

/**
 * Hand an offer edit to the workspace draft: sanitised (empty rows dropped), with the delivery line
 * the card reads kept in step when the offer decides one. Only offers {@link offerProblem} passes
 * reach here, through the editors' gated drafts.
 */
export function commitOffer(offer: ListingOffer): void {
	const clean = sanitiseOffer(offer);
	edit("offer", clean);
	const label = deliveryLabel(clean);
	if (label !== null && label !== draft.peek()?.delivery) edit("delivery", label);
}

/** The gate an offer editor's local draft passes through. */
export function checkOffer(offer: ListingOffer): OfferProblem | null {
	return offerProblem(offer);
}
