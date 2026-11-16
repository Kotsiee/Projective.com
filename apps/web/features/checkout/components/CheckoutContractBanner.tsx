import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { BuyerDetails, PostalAddress } from "../types/checkout-types.ts";

/**
 * CheckoutContractBanner — who the work goes to and who is billed, stated once at the top of the
 * payment step's reading column.
 *
 * These facts are already decided by the time the buyer reaches Payment, so the banner is quiet,
 * unboxed text — a section-header label, the recipient, and one Meta line — with an inline link back
 * to the Details step. The settlement currency and the FX rate are NOT restated here: the summary
 * rail discloses both beside the Order Total they qualify (PRODUCT_SPEC: the total in the buyer's
 * currency, the exact charge in the seller's, and the rate it was shown at).
 *
 * **An unfilled field says so in words.** A missing address prints "No address saved" rather than
 * collapsing to nothing, because a summary that silently omits a fact reads identically to one whose
 * fact is fine.
 */

// #region Address
/**
 * The one-line form of an address: street, then the locality's most identifying parts.
 *
 * Deliberately short. The banner's job is to let a buyer recognise the destination at a glance and
 * click through if it is wrong — the full record lives on the Details step, which is one link away.
 * Empty parts are dropped rather than printed blank, so a partially-filled record reads as short
 * instead of broken, and nothing is invented: an address with nothing in it returns `null` and the
 * caller says so.
 */
function addressLine(address: PostalAddress): string | null {
	const street = [address.line1, address.line2].map((part) => part.trim()).filter(Boolean)[0] ?? "";
	const locality = [address.city, address.postcode]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(" ");
	const parts = [street, locality, address.country.trim()].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : null;
}
// #endregion

// #region Props
/** Props for {@link CheckoutContractBanner}. */
export interface CheckoutContractBannerProps {
	/** The buyer's saved record for the ACTIVE billing identity — the same one the invoice prints. */
	buyer: BuyerDetails;
	/** The Details step in edit mode — `?edit=1`, or the auto-skip sends the buyer straight past it. */
	detailsHref: string;
}
// #endregion

/** The delivery and billing terms this payment will be made on. */
export function CheckoutContractBanner(props: CheckoutContractBannerProps): JSX.Element {
	const { buyer } = props;

	const business = buyer.contextKind === "business";
	const recipient = `${buyer.delivery.firstName} ${buyer.delivery.lastName}`.trim();
	const email = buyer.delivery.email.trim() ||
		(business ? buyer.business.corporateEmail : buyer.personal.email).trim();
	const address = addressLine(business ? buyer.business.address : buyer.personal.address);
	const billedTo = business
		? buyer.business.companyName.trim()
		: (buyer.personal.name.trim() || recipient);

	return (
		<section class="cko-contract" aria-labelledby="cko-contract-head">
			<div class="cko-contract__headrow">
				<h2 class="cko-contract__head" id="cko-contract-head">Billing &amp; delivery</h2>
				<a class="cko-contract__change" href={props.detailsHref}>
					Change Details
					<Icon name="arrow-right" size="2xs" />
				</a>
			</div>
			<p class="cko-contract__party">{recipient || billedTo || "No name saved"}</p>
			<MetaLine
				class="cko-contract__facts"
				items={[
					billedTo && billedTo !== recipient && `Billed to ${billedTo}`,
					email || { text: "No email saved", node: <span data-empty="true">No email saved</span> },
					address ??
						{ text: "No address saved", node: <span data-empty="true">No address saved</span> },
				]}
			/>
		</section>
	);
}
