import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type {
	BuyerDetails,
	CheckoutSettlement,
	PostalAddress,
} from "../types/checkout-types.ts";

/**
 * CheckoutContractBanner — the terms of the purchase, stated once at the top of the payment step.
 *
 * ## Why it exists, and why it is here rather than in the rail
 *
 * The delivery address, the billed identity and the settlement currency are the parts of a purchase
 * that are **already decided** by the time the buyer reaches Payment. They used to sit in the summary
 * rail, where they pushed the Order Total and the Buy Now button below the fold on a laned surface —
 * so the rail spent its most valuable space restating facts and its least valuable space on the
 * decision the page exists for. They belong at the top of the reading column instead: the buyer
 * confirms the contract, then chooses how to settle it, and the rail is left to answer "how much".
 *
 * ## What it says, and what it refuses to say
 *
 * **The FX line renders only when a conversion actually happened.** `settlement.rateLabel` is `null`
 * on a same-currency checkout, and the whole row is then absent — not a rate of 1.0, not an empty
 * stamp. A timestamp with no conversion behind it reads as a commitment the platform has not made,
 * and it is exactly the kind of clutter that trains a reader to stop reading the banner at all.
 *
 * **Every string here was composed server-side.** The rate statement, the snapshot stamp and the
 * currency label all arrive pre-formatted on `CheckoutSettlement`; this component concatenates
 * nothing and converts nothing. The rate in particular is read off the money that was actually
 * converted rather than resolved a second time — a printed rate that differs from the applied one is
 * the single FX failure a reader has no way to detect.
 *
 * **An unfilled field says so in words.** A missing address line prints "No address saved" rather
 * than collapsing to nothing, because a banner that silently omits a fact reads identically to a
 * banner whose fact is fine.
 *
 * ## Separation
 *
 * §B.4 allows the four-sided contour here: the banner is a single tonal surface carrying one hairline
 * and one link, drawn as a compact card because it is a distinct *statement* rather than a section of
 * the flow beneath it. Nothing inside it is boxed again.
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
	/** What this checkout settles in, and the FX observation behind it. Server-composed. */
	settlement: CheckoutSettlement;
	/** The Details step in edit mode — `?edit=1`, or the auto-skip sends the buyer straight past it. */
	detailsHref: string;
}
// #endregion

/** The delivery, billing and settlement terms this payment will be made on. */
export function CheckoutContractBanner(props: CheckoutContractBannerProps): JSX.Element {
	const { buyer, settlement } = props;

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
				<h2 class="cko-contract__head" id="cko-contract-head">Billing &amp; Delivery Summary</h2>
				{
					/*
					 * An ANCHOR wearing the quiet link treatment, not a button: it navigates to a real page,
					 * so it has to survive a middle-click and an open-in-new-tab. `?edit=1` is carried by the
					 * caller and is mandatory — the Details step auto-skips a complete record, so every other
					 * route into the form redirects straight past it.
					 */
				}
				<a class="cko-contract__change" href={props.detailsHref}>
					Change Details
					<Icon name="arrow-right" size="2xs" />
				</a>
			</div>

			<dl class="cko-contract__facts">
				<div class="cko-contract__fact" data-fact="parties">
					<dt class="cko-contract__key">Deliver &amp; bill to</dt>
					<dd class="cko-contract__val">
						<span class="cko-contract__party">
							{recipient || billedTo || "No name saved"}
						</span>
						{
							/*
							 * The billed identity is named separately ONLY when it differs from the recipient.
							 * On a personal purchase the two are the same person and printing the name twice
							 * invites the reader to look for a distinction that is not there.
							 */
						}
						{billedTo && billedTo !== recipient && (
							<span class="cko-contract__sub">
								Billed to {billedTo}
							</span>
						)}
						<span class="cko-contract__sub">
							{email || <span data-empty="true">No email saved</span>}
						</span>
						<span class="cko-contract__sub">
							{address ?? <span data-empty="true">No address saved</span>}
						</span>
					</dd>
				</div>

				<div class="cko-contract__fact" data-fact="currency">
					<dt class="cko-contract__key">Currency &amp; settlement</dt>
					<dd class="cko-contract__val">
						<span class="cko-contract__party">{settlement.label}</span>
						<span class="cko-contract__sub">
							{settlement.rateLabel
								? "Prices were set in another currency and converted for you."
								: "Every price on this order was set in this currency."}
						</span>
					</dd>
				</div>

				{
					/*
					 * Present ONLY when something was actually converted — see the component note. The stamp
					 * is the observation the platform priced against, stated in UTC because a rate is a fact
					 * about an instant and a local rendering of it is one more thing to disagree about.
					 */
				}
				{settlement.rateLabel && (
					<div class="cko-contract__fact" data-fact="fx">
						<dt class="cko-contract__key">Rate</dt>
						<dd class="cko-contract__val">
							<span class="cko-contract__party">{settlement.rateLabel}</span>
							{settlement.asOfLabel && (
								<span class="cko-contract__sub">Locked {settlement.asOfLabel}</span>
							)}
						</dd>
					</div>
				)}
			</dl>
		</section>
	);
}
