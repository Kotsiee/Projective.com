import type { JSX } from "preact";
import { Select, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { DetailsDraft } from "../core/details-draft.ts";
import type { MonthlyInvoicing } from "../types/checkout-types.ts";

/**
 * InvoicingSetup — consolidated monthly billing: pay per purchase, or collect the month onto one
 * statement raised on a chosen day.
 *
 * **Rendered and locked, never hidden.** When the account is not eligible the control still appears,
 * disabled, with the server's own `ineligibleReason` beside it — the `/wallet` rule (Decision #60):
 * a capability gate is expressed by ABSENCE, a verification gate by a locked control that teaches
 * the route to unlocking it. Removing the block entirely would hide the existence of a feature the
 * buyer can qualify for; showing it live and then refusing the save would be worse.
 *
 * **The reason is the server's sentence, reprinted.** Eligibility is KYB Level 3 — the same rule that
 * gates the `invoice` payment provider, because they are one decision ("may this account defer
 * settlement?") asked in two places. Nothing here re-derives it, so the two can never disagree.
 *
 * **The billing day stops at 28.** That is `org.business_profiles.billing_day`'s own CHECK and it is
 * deliberate: no month is shorter than 28 days, so a higher value would silently skip February.
 */

// #region Props
/** Props for {@link InvoicingSetup}. */
export interface InvoicingSetupProps {
	/** The draft whose invoicing mode and billing day this control moves. */
	draft: DetailsDraft;
	/** The server's offer for the active identity, including its refusal reason. */
	invoicing: MonthlyInvoicing;
	/** Block the controls while a save is in flight. */
	disabled?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}
// #endregion

/** `1` → `1st`. English-only, matching every other display label on this surface. */
function ordinal(day: number): string {
	const rem100 = day % 100;
	if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
	switch (day % 10) {
		case 1:
			return `${day}st`;
		case 2:
			return `${day}nd`;
		case 3:
			return `${day}rd`;
		default:
			return `${day}th`;
	}
}

/** The 28 selectable statement days. Built once, not per render. */
const BILLING_DAYS = Array.from({ length: 28 }, (_, index) => ({
	label: `${ordinal(index + 1)} of the month`,
	value: String(index + 1),
}));

export function InvoicingSetup(props: InvoicingSetupProps): JSX.Element {
	const { draft, invoicing, disabled, scope = "cko-details" } = props;
	const toggleId = `${scope}-invoicing-mode`;
	const dayId = `${scope}-invoicing-day`;
	const noteId = `${toggleId}-note`;

	const monthly = draft.invoicingMonthly.value;
	const locked = !invoicing.eligible;

	return (
		<div class="ckod-inv">
			<div class="ckod-inv__row">
				<ToggleSwitch
					id={toggleId}
					size="sm"
					label="Collect this month's purchases onto one invoice"
					value={draft.invoicingMonthly}
					disabled={disabled || locked}
					aria-describedby={noteId}
				/>
				{locked
					? (
						<span class="ckod-inv__lock">
							<Icon name="lock" size="2xs" />
							<span class="ui-visually-hidden">Not available on this account</span>
						</span>
					)
					: null}
			</div>

			<p class="ckod-inv__note" id={noteId}>
				{locked
					? invoicing.ineligibleReason ??
						"Monthly invoicing is available to verified business accounts."
					: monthly
					? invoicing.nextStatementLabel ??
						"Purchases are gathered and invoiced once a month."
					: "Each purchase is invoiced on its own, as it happens."}
			</p>

			{monthly && !locked
				? (
					<p class="ckod-field ckod-inv__day">
						<label class="ckod-field__label" for={dayId}>
							Statement day
						</label>
						<Select
							id={dayId}
							size="sm"
							value={draft.billingDay}
							options={BILLING_DAYS}
							disabled={disabled}
							aria-describedby={`${dayId}-note`}
						/>
						<span class="ckod-field__note" id={`${dayId}-note`}>
							The 28th is the last day every month has, so statements never skip February.
						</span>
					</p>
				)
				: null}
		</div>
	);
}
