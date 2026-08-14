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
 * `destinationEmail` still wins for that line; this is what pre-fills it, which is why the hint says
 * so rather than implying the address is final.
 *
 * **Two rows.** The name splits across the row because a first and last name are read as one fact;
 * the email takes the row beneath and is capped at `--field-max`, because an address stretched to
 * the form's full measure invites the reader to expect a longer value than one.
 */

// #region Props
/** Props for {@link DeliveryFields}. */
export interface DeliveryFieldsProps {
	draft: DetailsDraft;
	/** Block writes while a save is in flight. */
	disabled?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}
// #endregion

export function DeliveryFields(props: DeliveryFieldsProps): JSX.Element {
	const { draft, disabled, scope } = props;
	return (
		<div class="ckod__grid">
			<DetailsField
				draft={draft}
				path="delivery.firstName"
				label="First name"
				value={draft.delivery.firstName}
				required
				autoComplete="given-name"
				disabled={disabled}
				scope={scope}
				span="half"
			/>
			<DetailsField
				draft={draft}
				path="delivery.lastName"
				label="Last name"
				value={draft.delivery.lastName}
				required
				autoComplete="family-name"
				disabled={disabled}
				scope={scope}
				span="half"
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
				hint="Downloads and receipts go here. Any line with its own address keeps it."
				disabled={disabled}
				scope={scope}
				span="full"
				cap
			/>
		</div>
	);
}
