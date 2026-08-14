import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { adoptBillingContext, type DetailsDraft } from "../core/details-draft.ts";
import type { BillingContext } from "../types/checkout-types.ts";

/**
 * BillingContextSwitcher — the entity chip row: which legal identity this order is invoiced to, the
 * buyer personally or one of the companies they may bill through.
 *
 * **It is now the ONLY control that answers this.** It previously sat above a second
 * personal/business tab strip 300px further down the form, and the two disagreed by construction:
 * the row chose the identity while the tabs chose the invoice SHAPE, so a buyer could bill a company
 * on a personal invoice and never see which of the two the save would carry. One control, one
 * answer — picking a company IS choosing the company invoice, which is what reveals the registration
 * and VAT rows.
 *
 * **It is a view, never a mode.** Flipping it changes which billing block is on screen and which
 * `contextKind` the save carries; it discards nothing, because the draft holds both blocks at once.
 * A switcher that emptied the half it stopped showing would punish a buyer for checking something.
 * The one value it writes into the block is the company NAME, and only when that field is empty or
 * still holds a name this control put there — see {@link adoptBillingContext}.
 *
 * **Whose money is spent is a different question.** `PurchaseOwnerType` says which wallet pays;
 * this says which identity is invoiced, and the two are genuinely independent — a member paying from
 * their own wallet may still need a company invoice to be reimbursed. Deriving one from the other is
 * how a sole trader ends up unable to enter a VAT number.
 *
 * **"Add business" is a sibling, not a chip.** The identities form a `role="radiogroup"`, and a
 * navigation action inside a radiogroup is neither a valid option nor an announceable one — it would
 * read as a fourth identity the buyer could select. It sits at the end of the row as what it is: a
 * link out of the flow, and a real anchor rather than a scripted jump so it is middle-clickable and
 * reachable without JavaScript.
 *
 * **Selection does not ride on hue** (§A.5). The chosen chip carries a check mark and a heavier
 * label as well as its tint, so the answer survives a colour-blind reader, a high-contrast overlay
 * and a greyscale print.
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
	/** Fired after the identity changes, so the screen can react (the draft is already updated). */
	onChange?: (context: BillingContext) => void;
	/** Where a buyer with no company goes to create one; omitted hides the affordance. */
	addBusinessHref?: string;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}
// #endregion

/** The DOM id of one identity chip. Shared by the chip and the roving-focus mover. */
function chipId(scope: string, contextId: string): string {
	return `${scope}-billing-chip-${contextId.replaceAll(":", "-")}`;
}

export function BillingContextSwitcher(props: BillingContextSwitcherProps): JSX.Element | null {
	const { draft, contexts, disabled, scope = "cko-details" } = props;
	if (contexts.length === 0) return null;

	const groupId = `${scope}-billing-context`;
	const activeId = draft.contextId.value;
	const activeKind = draft.contextKind.value;

	const choose = (entry: BillingContext): void => {
		if (disabled) return;
		adoptBillingContext(draft, entry, contexts);
		props.onChange?.(entry);
	};

	/**
	 * Arrow-key navigation with selection following focus — the radiogroup pattern, and the same
	 * behaviour the retired tab strip implemented, so nothing was lost with it.
	 */
	const move = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void => {
		const last = contexts.length - 1;
		let next = index;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
		else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = last;
		else return;
		event.preventDefault();
		const target = contexts[next];
		choose(target);
		document.getElementById(chipId(scope, target.id))?.focus();
	};

	return (
		<div class="ckod-switch">
			<span class="ckod-switch__label" id={`${groupId}-label`}>Bill this order to</span>

			<div class="ckod-switch__row">
				<div
					id={groupId}
					class="ckod-chips"
					role="radiogroup"
					aria-labelledby={`${groupId}-label`}
				>
					{contexts.map((entry, index) => {
						const selected = entry.id === activeId;
						return (
							<button
								key={entry.id}
								id={chipId(scope, entry.id)}
								type="button"
								role="radio"
								class="ckod-chip"
								data-active={selected ? "true" : undefined}
								aria-checked={selected ? "true" : "false"}
								// Roving tabindex: the row is one tab stop, and the arrows move within it.
								tabIndex={selected ? 0 : -1}
								disabled={disabled}
								onClick={() => choose(entry)}
								onKeyDown={(event) => move(event, index)}
							>
								<span class="ckod-chip__mark" aria-hidden="true">
									{entry.avatar
										? <img class="ckod-chip__avatar" src={entry.avatar} alt="" />
										: <Icon name={entry.kind === "business" ? "building" : "user"} size="2xs" />}
								</span>
								<span class="ckod-chip__label">{entry.label}</span>
								{selected
									? (
										<span class="ckod-chip__check" aria-hidden="true">
											<Icon name="check" size="2xs" />
										</span>
									)
									: null}
							</button>
						);
					})}
				</div>

				{props.addBusinessHref
					? (
						<a class="ckod-chip ckod-chip--add" href={props.addBusinessHref}>
							<span class="ckod-chip__mark" aria-hidden="true">
								<Icon name="plus" size="2xs" />
							</span>
							<span class="ckod-chip__label">Add Business</span>
						</a>
					)
					: null}
			</div>

			<p class="ckod-switch__note">
				{activeKind === "business"
					? "Company details appear on the invoice, including the registration and VAT numbers below. Your delivery details stay as they are."
					: "Invoiced to you personally. Pick a company to bill it there and add a registration or VAT number."}
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
