import type { JSX } from "preact";
import type { FundingCharge } from "@projective/types/finance";
import { Button } from "@projective/ui/fields";
import { cx } from "@ui/core/cx.ts";
import { fundingConversionOf } from "../core/funding-charge.ts";
import "../styles/funding-conversion.css";

/** Props for {@link FundingConversion}. */
export interface FundingConversionProps {
	funding: FundingCharge;
	/** Re-read the charge in this currency: the payer chose to pay in it instead. */
	onPayIn: (currency: string) => void;
	/** A read or a payment is in flight. */
	disabled?: boolean;
	/** `start` under left-aligned copy; `center` (the default) under a centred figure. */
	align?: "center" | "start";
}

/**
 * FundingConversion — the lines under a funding's charge when its payer pays in their own currency
 * (Decision #436): what the escrow is listed at and the locked rate, the disclosed margin, and the other
 * currency it may be paid in, or why it cannot be paid in theirs now. Every figure is the server's
 * (`fundingConversionOf`); the board's Fund stage and the review's Buy a revision share it.
 */
export function FundingConversion(props: FundingConversionProps): JSX.Element | null {
	const lines = fundingConversionOf(props.funding);
	const target = lines.switchTo;
	if (!lines.listed && !lines.reason && !target) return null;
	return (
		<div class={cx("fund-fx", props.align === "start" && "fund-fx--start")}>
			{lines.listed && <p class="fund-fx__line">{lines.listed}</p>}
			{lines.margin && <p class="fund-fx__line">{lines.margin}</p>}
			{lines.reason && <p class="fund-fx__line">{lines.reason}</p>}
			{target && (
				<Button
					variant="link"
					size="sm"
					label={target.label}
					disabled={props.disabled}
					onClick={() => props.onPayIn(target.currency)}
				/>
			)}
		</div>
	);
}
