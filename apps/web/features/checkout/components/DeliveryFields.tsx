import type { JSX } from "preact";
import type { DetailsDraft } from "../core/details-draft.ts";
import { DetailsField } from "./AddressFields.tsx";

/**
 * DeliveryFields — where the order's digital deliverables go, and who to greet.
 *
 * **Three fields, and deliberately no physical address.** An individual buying a digital licence has
 * nothing shipped to them, and a checkout that demands a street for a file download is collecting
 * data it will never use — which is also data it then has to protect. The shape is identical for a
 * personal and a business buyer, because the person receiving the work is a person either way.
 *
 * The email here is the ACCOUNT-level default. A basket line that carries its own
 * `destinationEmail` still wins for that line; the section heading says so ("downloads and receipts
 * go here") rather than a standing hint under the field, which cost the form a row.
 *
 * **One row** (`3 + 3 + 6`): a first and last name are read as one fact and are short, and the email
 * takes the other half — wide enough for a real address, not so wide it invites the reader to expect
 * a longer value than one. Where the form column is narrower the three halve and the email wraps to
 * a row of its own (see the grid note in `checkout-details.css`).
 */

// #region Props
/** Props for {@link DeliveryFields}. */
export interface DeliveryFieldsProps {
	draft: DetailsDraft;
	/** A save is in flight: the controls turn read-only and keep focus. */
	busy?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}
// #endregion

export function DeliveryFields(props: DeliveryFieldsProps): JSX.Element {
	const { draft, busy, scope } = props;
	return (
		<div class="ckod__grid">
			<DetailsField
				draft={draft}
				path="delivery.firstName"
				label="First name"
				value={draft.delivery.firstName}
				required
				autoComplete="given-name"
				busy={busy}
				scope={scope}
				span={3}
			/>
			<DetailsField
				draft={draft}
				path="delivery.lastName"
				label="Last name"
				value={draft.delivery.lastName}
				required
				autoComplete="family-name"
				busy={busy}
				scope={scope}
				span={3}
			/>
			<DetailsField
				draft={draft}
				path="delivery.email"
				label="Email"
				value={draft.delivery.email}
				required
				email
				autoComplete="email"
				placeholder="name@example.com"
				busy={busy}
				scope={scope}
				span={6}
			/>
		</div>
	);
}
