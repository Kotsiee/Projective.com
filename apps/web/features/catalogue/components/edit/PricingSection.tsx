import type { JSX } from "preact";
import "../../styles/offer.css";
import { MoneyInput } from "@projective/ui/fields";
import { formatMoney } from "@projective/types/finance";
import { formArchetypeOf, resolveListingPricing } from "@projective/types/catalogue";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { draft, edit } from "../../core/workspace-store.ts";
import {
	askedPrice,
	minorOf,
	priceAsk,
	ticketRange,
	wholeOf,
	withAskedPrice,
} from "../../core/pricing-model.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";

const PRICE_ID = "cat-pricing-price";
const PRICE_HINT_ID = "cat-pricing-price-hint";
const CURRENCY_ID = "cat-pricing-currency";

/**
 * PricingSection — the one price the listing's form archetype is sold at (a fixed fee, a Pipeline's
 * baseline ticket, a fee per session or per seat), entered in the listing's currency, followed by the
 * price line exactly as the card will print it. The currency was chosen when the listing was created
 * and is shown, not edited.
 */
export function PricingSection(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const archetype = formArchetypeOf(listing.kind, listing.serviceType);
	const ask = priceAsk(archetype);
	const asked = askedPrice(listing.pricing, ask.field);
	const minor = minorOf(asked, listing.currency);
	const display = resolveListingPricing({
		kind: listing.kind,
		serviceType: listing.serviceType,
		pricing: listing.pricing,
		currency: listing.currency,
	});
	const range = ask.field === "ticketPrice" && minor !== null ? ticketRange(minor) : null;

	return (
		<EditSectionFrame section="pricing" intro="What buyers pay, as the card and the page show it.">
			<div class="cat-sec__field">
				<label class="cat-sec__label" for={PRICE_ID}>{ask.label}</label>
				<MoneyInput
					id={PRICE_ID}
					value={minor}
					onValueChange={(next) =>
						edit(
							"pricing",
							withAskedPrice(
								draft.peek()?.pricing ?? listing.pricing,
								ask.field,
								wholeOf(next, listing.currency),
							),
						)}
					currency={listing.currency}
					min={0}
					placeholder="Set a price"
					status={asked === null ? "gate" : "default"}
					aria-describedby={`${PRICE_HINT_ID} ${CURRENCY_ID}`}
				/>
				<p class="cat-sec__hint" id={PRICE_HINT_ID}>
					{range
						? `${ask.hint} That's ${formatMoney(range.low, listing.currency)} – ${
							formatMoney(range.high, listing.currency)
						} a ticket.`
						: ask.hint}
				</p>
			</div>

			{display.mode !== "quote" && (
				<p class="cat-offer__price">
					<span class="cat-offer__price-figure">{display.display}</span>
					{display.caption && <span class="cat-offer__price-caption">{display.caption}</span>}
				</p>
			)}
			<p class="cat-sec__hint" id={CURRENCY_ID}>
				Priced in {listing.currency}. The currency was set when the listing was created.
			</p>
		</EditSectionFrame>
	);
}
