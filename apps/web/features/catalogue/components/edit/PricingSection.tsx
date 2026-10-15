import type { JSX } from "preact";
import "../../styles/offer.css";
import { CurrencySelect, NumberInput } from "@projective/ui/fields";
import { DISPLAY_CURRENCIES, formatMoney } from "@projective/types/finance";
import {
	formArchetypeOf,
	hasBeenPublished,
	resolveListingPricing,
} from "@projective/types/catalogue";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { draft, edit } from "../../core/workspace-store.ts";
import {
	askedPrice,
	currencyOf,
	minorOf,
	priceAsk,
	ticketRange,
	withAskedPrice,
} from "../../core/pricing-model.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";

const PRICE_ID = "cat-pricing-price";
const PRICE_HINT_ID = "cat-pricing-price-hint";
const CURRENCY_ID = "cat-pricing-currency";
const CURRENCY_HINT_ID = "cat-pricing-currency-hint";

/**
 * PricingSection — the one price the listing's form archetype is sold at (a fixed fee, a Pipeline's
 * baseline ticket, a fee per session or per seat), entered in the listing's currency, followed by the
 * price line exactly as the card will print it. The currency can change until the listing first goes
 * live; from then on orders and payouts are recorded in it, so it is shown, not edited.
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
	const currencyFixed = hasBeenPublished(listing);

	return (
		<EditSectionFrame section="pricing" intro="What buyers pay, as the card and the page show it.">
			<div class="cat-sec__field">
				<label class="cat-sec__label" for={PRICE_ID}>{ask.label}</label>
				<NumberInput
					{...MONEY_FIELD}
					{...moneyDigits(listing.currency)}
					id={PRICE_ID}
					value={asked}
					onValueChange={(next: number | null) =>
						edit(
							"pricing",
							withAskedPrice(draft.peek()?.pricing ?? listing.pricing, ask.field, next),
						)}
					placeholder="Set a price"
					status={asked === null ? "gate" : "default"}
					aria-describedby={`${PRICE_HINT_ID} ${CURRENCY_HINT_ID}`}
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

			{currencyFixed
				? (
					<p class="cat-sec__hint" id={CURRENCY_HINT_ID}>
						Priced in {listing.currency}. The currency is fixed once a listing has been published.
					</p>
				)
				: (
					<div class="cat-sec__field">
						<label class="cat-sec__label" for={CURRENCY_ID}>Currency</label>
						<div class="cat-offer__compact">
							<CurrencySelect
								id={CURRENCY_ID}
								currencies={DISPLAY_CURRENCIES}
								value={listing.currency}
								onValueChange={(code) => {
									const next = currencyOf(code);
									if (next && next !== listing.currency) edit("currency", next);
								}}
								aria-describedby={CURRENCY_HINT_ID}
							/>
						</div>
						<p class="cat-sec__hint" id={CURRENCY_HINT_ID}>
							Every price on this listing is in this currency. It is fixed once the listing is
							published.
						</p>
					</div>
				)}
		</EditSectionFrame>
	);
}
