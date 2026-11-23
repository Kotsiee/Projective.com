import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { NumberInput, ToggleSwitch } from "@projective/ui/fields";
import { formatMoney } from "@projective/types/finance";
import {
	extraRevisionCap,
	type FormArchetype,
	revisionPriceRefusal,
	revisionsUnlimited,
} from "@projective/types/catalogue";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import type { ListingDetail, ListingPricing } from "../../../types/catalogue-types.ts";
import { draft, edit } from "../../../core/workspace-store.ts";
import { minorOf, withUnlimitedRevisions } from "../../../core/pricing-model.ts";
import { FieldHead } from "../FieldHead.tsx";

const UNLIMITED_HINT_ID = "cat-pricing-rev-unlimited-hint";
const FREE_ID = "cat-pricing-rev-free";
const FREE_HINT_ID = "cat-pricing-rev-free-hint";
const EXTRA_ID = "cat-pricing-rev-extra";
const EXTRA_HINT_ID = "cat-pricing-rev-extra-hint";
const EXTRA_CAP_ID = "cat-pricing-rev-extra-cap";

/** Props for {@link RevisionFields}. */
export interface RevisionFieldsProps {
	listing: ListingDetail;
	archetype: FormArchetype;
	/** The extra-round field's value, mirrored so a lowered price can lower it in place. */
	extraField: Signal<number | null>;
}

/**
 * RevisionFields — the revision rounds a delivery offer includes, per stage on a Pipeline, and what a
 * round costs after that (Decision #525). **Unlimited revisions** is a free extra round (`0`), the
 * reading `/view` and the stage instantiation already give it; off, the free count and the extra price
 * are their own fields. Leaving the count empty keeps the platform's standard allowance (`null`),
 * apart from declaring none (`0`). The extra price is capped at half the price it revises, so the
 * field cannot go past it and says where the cap is.
 */
export function RevisionFields(props: RevisionFieldsProps): JSX.Element {
	const { listing, archetype, extraField } = props;
	const pricing = listing.pricing;
	const unlimited = revisionsUnlimited(pricing);
	const current = (): ListingPricing => draft.peek()?.pricing ?? pricing;
	const cap = extraRevisionCap(pricing, archetype, listing.currency);
	const capMinor = minorOf(cap, listing.currency);
	const refusal = revisionPriceRefusal(pricing, archetype, listing.currency);
	const perStage = archetype === "pipeline";
	const priceNoun = perStage ? "the ticket price" : "the price";

	const setUnlimited = (on: boolean) => {
		const next = withUnlimitedRevisions(current(), on);
		extraField.value = next.extraRevisionPrice;
		edit("pricing", next);
	};

	return (
		<div class="cat-pricing__revisions">
			<div class="cat-pricing__switchrow">
				<FieldHead
					label="Unlimited revisions"
					decorative
					hint="Buyers can ask for as many rounds as they need, at no extra cost."
					hintId={UNLIMITED_HINT_ID}
				>
					<ToggleSwitch
						value={unlimited}
						onValueChange={setUnlimited}
						aria-label="Unlimited revisions"
						aria-describedby={UNLIMITED_HINT_ID}
					/>
				</FieldHead>
			</div>

			{unlimited
				? (
					<p class="cat-sec__hint">
						Every round is free{perStage ? ", in every stage" : ""}.
					</p>
				)
				: (
					<div class="cat-offer__row">
						<div class="cat-sec__field">
							<FieldHead
								label="Free revisions"
								htmlFor={FREE_ID}
								hint={`${
									perStage ? "Included in every stage" : "Included before any extra cost"
								}. Leave it empty to offer the platform's standard allowance.`}
								hintId={FREE_HINT_ID}
							/>
							<NumberInput
								id={FREE_ID}
								class="cat-offer__count"
								value={pricing.freeRevisions}
								onValueChange={(n) =>
									edit("pricing", {
										...current(),
										freeRevisions: n === null ? null : Math.round(n),
									})}
								min={0}
								max={99}
								maxFractionDigits={0}
								icon="refresh"
								enableIconScrub
								suffix={pricing.freeRevisions === 1 ? "round" : "rounds"}
								placeholder="Standard"
								aria-describedby={FREE_HINT_ID}
							/>
						</div>
						<div class="cat-sec__field">
							<FieldHead
								label="Each extra round"
								htmlFor={EXTRA_ID}
								hint="Leave it empty to agree a price when it comes up."
								hintId={EXTRA_HINT_ID}
							/>
							<NumberInput
								{...MONEY_FIELD}
								{...moneyDigits(listing.currency)}
								id={EXTRA_ID}
								value={extraField}
								onValueChange={(next: number | null) => {
									extraField.value = next;
									edit("pricing", { ...current(), extraRevisionPrice: next });
								}}
								max={cap ?? 0}
								disabled={cap === null}
								placeholder={cap === null ? "Set the price first" : "Not priced"}
								status={refusal ? "invalid" : "default"}
								aria-describedby={`${EXTRA_HINT_ID} ${EXTRA_CAP_ID}`}
							/>
							<p class="cat-sec__hint" id={EXTRA_CAP_ID} role={refusal ? "status" : undefined}>
								{capMinor === null
									? "Price the listing first; a round can cost up to half of it."
									: `Up to ${formatMoney(capMinor, listing.currency)}, half ${priceNoun}.`}
							</p>
						</div>
					</div>
				)}
		</div>
	);
}
