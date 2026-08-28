import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import type { CheckoutBlocker, CheckoutBlockerCode } from "../types/checkout-types.ts";

/**
 * CheckoutBlockers — everything standing between the buyer and a completed payment, named.
 *
 * It is the FIRST thing in the body, above what is being bought, because what stops a payment is more
 * useful than what the payment is for once something has stopped it. The Pay control lives in the
 * footer band and is disabled while this list is non-empty; the pairing of a refused control with a
 * visible, specific reason on the same screen is the region contract's answer to a dead button.
 *
 * Two rules hold here:
 *
 * - **Every blocker names its own fix.** The `message` is the server's sentence, rendered verbatim —
 *   it was written to be read by the person who has to act on it, and paraphrasing it here would put
 *   two wordings of one refusal into the product.
 * - **A line-scoped blocker links to its line.** `itemId` is what makes "confirm the time for X"
 *   actionable in a list of nine purchases, and the anchor is the only navigation this component owns.
 */

// #region Props
/** Props for {@link CheckoutBlockers}. */
export interface CheckoutBlockersProps {
	/** The obstacles, server-sent and client-owned alike. Empty renders nothing at all. */
	blockers: readonly CheckoutBlocker[];
	/** Heading for the group. */
	title: string;
	/** DOM id prefix used to link a line-scoped blocker to its row. */
	lineIdPrefix: string;
	/** The heading's element id, so the list can be labelled by it. */
	id?: string;
}
// #endregion

/** The glyph a blocker code is marked with — a shape channel beside the tone, never hue alone. */
function blockerIcon(code: CheckoutBlockerCode): IconName {
	switch (code) {
		case "empty":
			return "basket";
		case "not_authorised":
			return "lock";
		case "unavailable_item":
			return "warning";
		case "missing_email":
			return "mail";
		case "missing_schedule":
			return "calendar";
		case "missing_stage":
			return "stages";
		case "no_provider":
			return "wallet";
		case "insufficient_funds":
			return "wallet";
		case "verification_required":
			// A shield, NOT the `verified` crest. The crest is the product's assertion that an entity
			// HAS been verified; this row exists precisely because it has not, and the blocker list is
			// tinted `--warning`/`--danger`, so the crest would have arrived here painted in the alarm
			// colour beside the sentence denying what it claims. Two concepts under one name is the
			// other half of §B.7.7's ban, and it is the half that misinforms rather than merely
			// looking inconsistent. The shield says "a gate stands here", which is the true statement.
			return "shield";
		case "price_changed":
			return "refresh";
		case "missing_details":
			return "user";
		case "spend_limit":
			return "shield";
		default:
			return "info";
	}
}

/** Render the current obstacles, or nothing when there are none. */
export function CheckoutBlockers(props: CheckoutBlockersProps): JSX.Element | null {
	const { blockers, title, lineIdPrefix, id = "cko-blockers-head" } = props;
	if (blockers.length === 0) return null;

	return (
		<section class="cko-block" role="status" aria-live="polite" aria-labelledby={id}>
			<h2 class="cko-block__head" id={id}>
				<Icon name="warning" />
				{title}
			</h2>
			<ul class="cko-block__list">
				{blockers.map((blocker, index) => (
					<li
						key={`${blocker.code}-${blocker.itemId ?? "account"}-${index}`}
						class="cko-block__item"
						data-code={blocker.code}
					>
						<Icon name={blockerIcon(blocker.code)} class="cko-block__icon" />
						<span class="cko-block__text">{blocker.message}</span>
						{blocker.itemId && (
							<a class="cko-block__link" href={`#${lineIdPrefix}${blocker.itemId}`}>
								Go to it
							</a>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
