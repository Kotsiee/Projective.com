import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	conversionBreakdownLines,
	type ConversionQuote,
	fxBreakdownLines,
	type FxQuote,
} from "../core/checkout-model.ts";

// #region Props
/** Props for {@link FxBreakdown}. */
export interface FxBreakdownProps {
	/** What the exact figure is: the processor's charge, or a balance the wallet holds. */
	kind: "charged" | "held";
	/** The exact figure in its own currency, as the server formatted it. */
	exact: { currency: string; display: string };
	/** The quote behind the conversion; its rate prints only when it converts {@link exact}'s currency. */
	settlement: FxQuote;
	/**
	 * A charge converted into the buyer's own currency (Decision #435): what the order is listed at and
	 * the locked quote. Its breakdown replaces the bank caveat with the rate and the disclosed margin.
	 */
	conversion?: { listed: { currency: string; display: string }; quote: ConversionQuote } | null;
	/** Element id of the always-present breakdown sentence the trigger is described by. */
	id: string;
	/** A recompute is in flight: the panel stays shut and the stale figure is not announced. */
	pending?: boolean;
}
// #endregion

/**
 * FxBreakdown — the ⓘ beside a figure the buyer reads in their own currency but is charged or held
 * in another. The exact figure, the locked rate and the bank-fee caveat live one press away in a
 * portal {@link Tooltip} (`toggleOnPress`, so a tap opens it), drawn above the modal and sticky-rail
 * clip boxes. Every string is the server's; the same sentences are always in the DOM as the
 * trigger's `aria-describedby`, so a screen reader hears them without opening anything.
 */
export function FxBreakdown(props: FxBreakdownProps): JSX.Element {
	const lines = props.conversion
		? conversionBreakdownLines(props.exact, props.conversion.listed, props.conversion.quote)
		: fxBreakdownLines(props.kind, props.exact, props.settlement);
	const pending = props.pending ?? false;
	const [lead, ...rest] = lines;
	const panel = (
		<span class="cko-fx__panel">
			<span class="cko-fx__lead">{lead}</span>
			{rest.map((line) => <span key={line} class="cko-fx__line">{line}</span>)}
		</span>
	);

	return (
		<span class="cko-fx">
			<Tooltip content={pending ? "" : panel} placement="top" variant="surface" toggleOnPress>
				<button
					type="button"
					class="cko-fx-trigger"
					aria-label="View currency and exchange rate breakdown"
					aria-describedby={pending ? undefined : props.id}
					aria-disabled={pending ? "true" : undefined}
				>
					<Icon name="info" size="xs" />
				</button>
			</Tooltip>
			{pending ? null : <span class="ui-visually-hidden" id={props.id}>{lines.join(" ")}</span>}
		</span>
	);
}
