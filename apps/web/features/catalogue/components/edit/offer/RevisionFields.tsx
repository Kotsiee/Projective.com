import type { JSX } from "preact";
import { NumberInput, NumberStepper, ToggleSwitch } from "@projective/ui/fields";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import type { ListingDetail } from "../../../types/catalogue-types.ts";
import { draft, edit } from "../../../core/workspace-store.ts";
import { withRevisionsDeclared } from "../../../core/pricing-model.ts";

const FREE_ID = "cat-offer-rev-free";
const FREE_HINT_ID = "cat-offer-rev-free-hint";
const EXTRA_ID = "cat-offer-rev-extra";
const EXTRA_HINT_ID = "cat-offer-rev-extra-hint";

/**
 * RevisionFields — the revision rounds a delivery offer includes, per stage, and what a round costs
 * after that. Not declaring an allowance is its own answer ("Not set": the platform default applies)
 * and stays apart from declaring none (`0`). Both live on the listing's pricing.
 */
export function RevisionFields(props: { listing: ListingDetail; perStage: boolean }): JSX.Element {
	const { listing } = props;
	const pricing = listing.pricing;
	const declared = pricing.freeRevisions !== null;
	const editPricing = (next: typeof pricing) => edit("pricing", next);
	const current = () => draft.peek()?.pricing ?? pricing;

	return (
		<div class="cat-offer__row">
			<div class="cat-sec__field">
				<div class="cat-sec__labelrow">
					{declared
						? <label class="cat-sec__label" for={FREE_ID}>Free revisions</label>
						: <span class="cat-sec__label">Free revisions</span>}
					<ToggleSwitch
						value={declared}
						onValueChange={(on) => editPricing(withRevisionsDeclared(current(), on))}
						label="State free revisions"
					/>
				</div>
				{declared
					? (
						<div class="cat-offer__compact">
							<NumberStepper
								id={FREE_ID}
								value={pricing.freeRevisions}
								onValueChange={(n) =>
									editPricing({ ...current(), freeRevisions: n === null ? 0 : n })}
								min={0}
								max={99}
								unit={pricing.freeRevisions === 1 ? "round" : "rounds"}
								aria-describedby={FREE_HINT_ID}
							/>
						</div>
					)
					: <p class="cat-sec__value">Not set</p>}
				<p class="cat-sec__hint" id={FREE_HINT_ID}>
					{declared
						? props.perStage ? "Included in every stage." : "Included before any extra cost."
						: "Buyers see the platform's standard allowance."}
				</p>
			</div>
			<div class="cat-sec__field">
				<label class="cat-sec__label" for={EXTRA_ID}>Each extra round</label>
				<NumberInput
					{...MONEY_FIELD}
					{...moneyDigits(listing.currency)}
					id={EXTRA_ID}
					value={pricing.extraRevisionPrice}
					onValueChange={(next: number | null) =>
						editPricing({ ...current(), extraRevisionPrice: next })}
					placeholder="Not priced"
					aria-describedby={EXTRA_HINT_ID}
				/>
				<p class="cat-sec__hint" id={EXTRA_HINT_ID}>
					Leave it empty to agree a price when it comes up. Zero means extra rounds are free.
				</p>
			</div>
		</div>
	);
}
