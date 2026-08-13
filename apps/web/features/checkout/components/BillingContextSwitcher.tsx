import type { JSX } from "preact";
import { Button, SelectButton } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { DetailsDraft } from "../core/details-draft.ts";
import type { BillingContext } from "../types/checkout-types.ts";

/**
 * BillingContextSwitcher — which legal identity this order is invoiced to: the buyer personally, or
 * one of the companies they may bill through.
 *
 * **It is a view, never a mode.** Flipping it changes which billing block is on screen and which
 * `contextKind` the save carries; it discards nothing, because the draft holds both blocks at once.
 * A switcher that emptied the half it stopped showing would punish a buyer for checking something.
 *
 * **Whose money is spent is a different question.** `PurchaseOwnerType` says which wallet pays;
 * this says which identity is invoiced, and the two are genuinely independent — a member paying from
 * their own wallet may still need a company invoice to be reimbursed. Deriving one from the other is
 * how a sole trader ends up unable to enter a VAT number.
 *
 * **"Add business" is a sibling, not a segment.** The identities form a `role="radiogroup"`, and a
 * navigation action inside a radiogroup is neither a valid option nor an announceable one — it would
 * read as a fourth identity the buyer could select. It sits beside the group as what it is: a link
 * out of the flow.
 */

// #region Props
/** Props for {@link BillingContextSwitcher}. */
export interface BillingContextSwitcherProps {
	/** The draft whose active identity this control moves. */
	draft: DetailsDraft;
	/** Every identity the viewer may bill through, from the server projection. */
	contexts: readonly BillingContext[];
	/** Block the control while a save is in flight. */
	disabled?: boolean;
	/** Fired after the identity changes, so the screen can re-resolve its department options. */
	onChange?: (context: BillingContext) => void;
	/** Where a buyer with no company goes to create one. */
	addBusinessHref?: string;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}
// #endregion

export function BillingContextSwitcher(props: BillingContextSwitcherProps): JSX.Element | null {
	const { draft, contexts, disabled, scope = "cko-details" } = props;
	if (contexts.length === 0) return null;

	const groupId = `${scope}-billing-context`;

	return (
		<div class="ckod-switch">
			<span class="ckod-switch__label" id={`${groupId}-label`}>Bill this order to</span>
			<div class="ckod-switch__row">
				<SelectButton
					id={groupId}
					size="sm"
					value={draft.contextId}
					disabled={disabled}
					aria-describedby={`${groupId}-label`}
					aria-label="Billing identity"
					options={contexts.map((entry) => ({
						label: entry.label,
						value: entry.id,
					}))}
					onValueChange={(next) => {
						const id = Array.isArray(next) ? next[0] ?? "" : next;
						const chosen = contexts.find((entry) => entry.id === id);
						if (!chosen) return;
						// The KIND is what the fields and the save read; the id names which identity it is.
						draft.contextKind.value = chosen.kind;
						props.onChange?.(chosen);
					}}
				/>
				{props.addBusinessHref
					? (
						<Button
							variant="text"
							size="sm"
							icon={<Icon name="plus" size="2xs" />}
							onClick={() => {
								globalThis.location.assign(props.addBusinessHref as string);
							}}
						>
							Add business
						</Button>
					)
					: null}
			</div>
			<p class="ckod-switch__note">
				{draft.contextKind.value === "business"
					? "Company details appear on the invoice. Your delivery details stay as they are."
					: "Invoiced to you personally. Switch to a company to add a VAT or registration number."}
			</p>
		</div>
	);
}

/** The identity a draft currently addresses, or `null` when it names one the viewer cannot bill. */
export function activeBillingContext(
	contexts: readonly BillingContext[],
	contextId: string,
): BillingContext | null {
	return contexts.find((entry) => entry.id === contextId) ?? null;
}
