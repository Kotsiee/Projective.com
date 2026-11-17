import type { FundingCharge } from "@projective/types/finance";

/**
 * funding-charge — what a funding dialog says about the currency it charges in (Decision #436), from
 * the server's `FundingCharge` and nothing else: every figure and label is the server's, so the
 * board's Fund stage and the review's Buy a revision word one quote the same way as the checkout.
 */

/** The lines under a funding's charge, and the other currency it may be paid in. */
export interface FundingConversion {
	/** `Listed at €90.00 EUR at 1 GBP = 1.17 EUR`: the escrow's own amount and the locked rate. */
	listed: string | null;
	/** `Includes the 1.5% conversion margin: £1.15`, or that there is none. */
	margin: string | null;
	/** The currency the payer may pay in instead, with the label that offers it. */
	switchTo: { currency: string; label: string } | null;
	/** Why paying in their own currency is not possible now, when the server said why. */
	reason: string | null;
}

/** The conversion lines for one funding: none when it is charged in the project's own currency. */
export function fundingConversionOf(funding: FundingCharge): FundingConversion {
	const quote = funding.charge.quote;
	const { payIn } = funding;
	const twoCurrencies = payIn.billing !== payIn.order;
	const other = payIn.selected === payIn.billing ? payIn.order : payIn.billing;
	return {
		listed: quote
			? `Listed at ${funding.listed.display} ${funding.listed.currency} at ${quote.rateLabel}`
			: null,
		margin: quote
			? quote.marginBp > 0
				? `Includes the ${quote.marginLabel}: ${quote.margin.display}`
				: quote.marginLabel
			: null,
		switchTo: twoCurrencies && payIn.conversion
			? { currency: other, label: `Pay in ${other} instead` }
			: null,
		reason: twoCurrencies && !payIn.conversion ? payIn.reason : null,
	};
}
