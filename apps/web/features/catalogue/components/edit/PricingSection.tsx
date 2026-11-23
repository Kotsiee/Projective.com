import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../../styles/offer.css";
import {
	CurrencySelect,
	InputGroup,
	InputGroupAddon,
	NumberInput,
	SelectButton,
} from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { DISPLAY_CURRENCIES, formatMoney } from "@projective/types/finance";
import {
	formArchetypeOf,
	hasBeenPublished,
	hasVariableSessionLengths,
	sellsRevisions,
} from "@projective/types/catalogue";
import { commitOffer } from "../../core/offer-commit.ts";
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
	withRevisionCap,
} from "../../core/pricing-model.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { FieldHead } from "./FieldHead.tsx";
import { OfferGroup } from "./offer/OfferGroup.tsx";
import { RevisionFields } from "./pricing/RevisionFields.tsx";

const PRICE_ID = "cat-pricing-price";
const PRICE_HINT_ID = "cat-pricing-price-hint";
const CURRENCY_HINT_ID = "cat-pricing-currency-hint";
const UNIT_HINT_ID = "cat-pricing-unit-hint";

/**
 * PricingSection — the one price the listing's form archetype is sold at (a fixed fee, a Pipeline's
 * baseline ticket, a fee per session or per seat), entered beside its currency in one fused group;
 * the live card in the panel shows the price line, so the section does not repeat it (Decision
 * #525). The currency can change until the listing first goes live; from then on orders and payouts
 * are recorded in it, so it is shown, not edited. A delivery offer prices its revision rounds here
 * too, the extra round capped at half the price and lowered with it when the price drops.
 */
export function PricingSection(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const archetype = formArchetypeOf(listing.kind, listing.serviceType);
	const timed = listing.offer.archetype === "session" || listing.offer.archetype === "cohort"
		? listing.offer
		: null;
	const perHour = timed?.pricingUnit === "per_hour";
	// Sessions of different lengths are sold by the hour (SC10), so per session is locked meanwhile.
	const varied = timed !== null && hasVariableSessionLengths(timed);
	const ask = priceAsk(archetype, perHour);
	const asked = askedPrice(listing.pricing, ask.field);
	const minor = minorOf(asked, listing.currency);
	const tiered = listing.offer.archetype === "pipeline" && listing.offer.allowTieredIntensity;
	const range = tiered && ask.field === "ticketPrice" && minor !== null ? ticketRange(minor) : null;
	const currencyFixed = hasBeenPublished(listing);
	const extraField = useSignal<number | null>(listing.pricing.extraRevisionPrice);

	const setPrice = (whole: number | null) => {
		const before = draft.peek()?.pricing ?? listing.pricing;
		const next = withRevisionCap(
			withAskedPrice(before, ask.field, whole),
			archetype,
			listing.currency,
		);
		if (next.extraRevisionPrice !== before.extraRevisionPrice) {
			extraField.value = next.extraRevisionPrice;
		}
		edit("pricing", next);
	};

	return (
		<EditSectionFrame section="pricing" intro="What buyers pay, as the card and the page show it.">
			{timed && (
				<div class="cat-sec__field">
					<FieldHead
						label="Charge"
						hint="Per session: every session costs the price. Per hour: the price is an hourly rate, and each session costs it for its own length."
						hintId={UNIT_HINT_ID}
					/>
					<SelectButton
						options={[
							{ label: "Per session", value: "per_session", disabled: varied },
							{ label: "Per hour", value: "per_hour" },
						]}
						value={perHour ? "per_hour" : "per_session"}
						onValueChange={(v) => {
							const unit = v === "per_hour" ? "per_hour" : "per_session";
							if (unit !== timed.pricingUnit && !(unit === "per_session" && varied)) {
								commitOffer({ ...timed, pricingUnit: unit });
							}
						}}
						aria-label="How sessions are charged"
						aria-describedby={UNIT_HINT_ID}
					/>
					{varied && (
						<InlineNotice
							icon={<Icon name="info" />}
							text="Your sessions have lengths of their own, so they are priced per hour. Give them one length on the session plan to price per session."
						/>
					)}
				</div>
			)}
			<div class="cat-sec__field">
				<FieldHead label={ask.label} htmlFor={PRICE_ID} hint={ask.hint} hintId={PRICE_HINT_ID} />
				<InputGroup class="cat-pricing__price" fluid>
					{currencyFixed
						? (
							<InputGroupAddon class="cat-pricing__code" aria-hidden="true">
								{listing.currency}
							</InputGroupAddon>
						)
						: (
							<CurrencySelect
								class="cat-pricing__currency"
								currencies={DISPLAY_CURRENCIES}
								value={listing.currency}
								onValueChange={(code) => {
									const next = currencyOf(code);
									if (next && next !== listing.currency) edit("currency", next);
								}}
								aria-label="Currency"
								aria-describedby={CURRENCY_HINT_ID}
							/>
						)}
					<NumberInput
						{...MONEY_FIELD}
						{...moneyDigits(listing.currency)}
						id={PRICE_ID}
						value={asked}
						onValueChange={setPrice}
						placeholder="Set a price"
						status={asked === null ? "gate" : "default"}
						aria-describedby={`${PRICE_HINT_ID} ${CURRENCY_HINT_ID}`}
						fluid
					/>
				</InputGroup>
				<p class="cat-sec__hint" id={CURRENCY_HINT_ID}>
					{currencyFixed
						? `Priced in ${listing.currency}. The currency is fixed once a listing has been published.`
						: "Every price on this listing is in this currency. It is fixed once the listing is published."}
				</p>
				{range && (
					<p class="cat-sec__hint">
						Buyers see {formatMoney(range.low, listing.currency)} –{" "}
						{formatMoney(range.high, listing.currency)} a ticket.
					</p>
				)}
			</div>

			{sellsRevisions(archetype) && (
				<OfferGroup title="Revisions">
					<RevisionFields listing={listing} archetype={archetype} extraField={extraField} />
				</OfferGroup>
			)}
		</EditSectionFrame>
	);
}
