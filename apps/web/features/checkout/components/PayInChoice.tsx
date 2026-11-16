import type { JSX } from "preact";
import type { CheckoutPayIn } from "../types/checkout-types.ts";

/** Props for {@link PayInChoice}. */
export interface PayInChoiceProps {
	/** The currencies this checkout may be paid in, as the server resolved them. */
	payIn: CheckoutPayIn | null;
	/** The payment step in each currency it may be paid in, keyed by currency (`payInHrefs`). */
	hrefs: Readonly<Record<string, string>>;
}

/**
 * PayInChoice — the other currency a checkout may be paid in (Decision #435): the order's own when the
 * charge is converted into the buyer's billing currency, the billing currency when they chose the
 * order's. A link, because the choice is the `?pay_in=` address the server prices; when paying in the
 * billing currency is not possible now, the server's reason is said instead.
 */
export function PayInChoice(props: PayInChoiceProps): JSX.Element | null {
	const { payIn, hrefs } = props;
	if (!payIn || payIn.billing === payIn.order) return null;
	if (!payIn.conversion) {
		return payIn.reason ? <p class="cko-rail__payin">{payIn.reason}</p> : null;
	}
	const other = payIn.selected === payIn.billing ? payIn.order : payIn.billing;
	const href = hrefs[other];
	if (!href) return null;
	return (
		<p class="cko-rail__payin">
			<a class="cko-rail__payin-link" href={href}>Pay in {other} instead</a>
		</p>
	);
}
