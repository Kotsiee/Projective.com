import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Tooltip } from "@projective/ui/feedback";
import { Checkbox } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import type { ProcessingContributionOffer } from "../types/checkout-types.ts";

/**
 * ProcessingContribution — the buyer's voluntary offer to cover the card scheme's cut.
 *
 * Three rules make this a gift rather than a surcharge, and each is enforced structurally rather
 * than by wording:
 *
 * 1. **It is never on by default.** The control renders unchecked unless the SERVER says the buyer
 *    already opted in ({@link ProcessingContributionOffer.optedIn}), so a total can never grow
 *    because nobody looked at a pre-ticked box.
 * 2. **The amount is the server's.** `offer.amount` arrives pre-computed and pre-formatted; this
 *    component prints it and never derives, adds or converts it. When the buyer toggles, the caller
 *    re-reads the session with `contribute=1` and the whole totals block comes back recomputed —
 *    which is why there is no arithmetic here to get wrong.
 * 3. **The offer disappears when it does not apply.** A wallet or invoice payment touches no card
 *    scheme, so there is no third-party cost to help with; the server sets `offered: false` and this
 *    renders nothing at all. A permanently-visible-but-disabled ask would read as a fee the buyer is
 *    being kept from declining.
 *
 * The explanation lives in a portal {@link Tooltip} on the info affordance rather than a native
 * `title` (§B.6.4), and the same sentence is bound as the control's `aria-describedby`, so it is
 * read out on arrival instead of only being hoverable.
 */

// #region Props
/** Props for {@link ProcessingContribution}. */
export interface ProcessingContributionProps {
	/** The server's offer. `offered: false` renders nothing. */
	offer: ProcessingContributionOffer;
	/** Controlled opt-in state — the shared `contributionOptedIn` signal. */
	optedIn: Signal<boolean>;
	/** Whether a read is in flight, so the control cannot be toggled mid-recompute. */
	busy?: boolean;
	/** Fired with the new state; the caller re-reads the session so the TOTAL comes from the server. */
	onToggle: (next: boolean) => void;
}
// #endregion

/** Render the voluntary gateway contribution, or nothing when it is not on offer. */
export function ProcessingContribution(props: ProcessingContributionProps): JSX.Element | null {
	const { offer, optedIn, busy = false } = props;
	if (!offer.offered) return null;

	const noteId = "cko-contrib-note";

	return (
		<section class="cko-contrib" aria-labelledby="cko-contrib-head">
			<div class="cko-contrib__row">
				<Checkbox
					id="cko-contrib-box"
					value={optedIn}
					disabled={busy}
					aria-describedby={noteId}
					onValueChange={(next: boolean) => props.onToggle(next)}
				/>
				<label class="cko-contrib__label" for="cko-contrib-box" id="cko-contrib-head">
					Help cover the card processing fee
				</label>

				{
					/*
					 * The info mark is the tooltip's anchor and is itself focusable, so the explanation is
					 * reachable by keyboard. It carries no fact of its own — `aria-describedby` already
					 * binds the same sentence to the checkbox — which is why it is `aria-hidden` inside a
					 * labelled button rather than a bare glyph.
					 */
				}
				<Tooltip content={offer.note} placement="top">
					<button
						type="button"
						class="cko-contrib__info"
						aria-label="What is the card processing fee?"
					>
						<Icon name="info" />
					</button>
				</Tooltip>

				<span class="cko-contrib__amount">
					<Amount
						value={offer.amount}
						size="body"
						tone={optedIn.value ? "default" : "muted"}
						sign="+"
						srLabel={optedIn.value
							? undefined
							: `${offer.amount.display}, only added if you choose to`}
					/>
				</span>
			</div>

			<p class="cko-contrib__note" id={noteId}>{offer.note}</p>
		</section>
	);
}
