import type { JSX } from "preact";
import { Select } from "@projective/ui/fields";
import { billingContextKind } from "../core/checkout-state.ts";
import {
	type DepartmentOption,
	type DetailsDraft,
	detailsFieldId,
	markTouched,
} from "../core/details-draft.ts";
import { AddressFields, DetailsField } from "./AddressFields.tsx";
import { PhoneField } from "./PhoneField.tsx";
import type { BillingContextKind } from "../types/checkout-types.ts";

/**
 * BillingFields — the invoiced identity: a natural person's block, or a company's — and
 * {@link BillingKindTabs}, the underlined tab row that chooses between them.
 *
 * **Both blocks exist in the draft at all times; only one is rendered.** The tabs choose which, and
 * switching discards nothing — the record carries both, so a buyer who fills the company form, flips
 * to Personal to correct a spelling and flips back finds their work where they left it. That is the
 * whole reason `BuyerDetailsSchema` is not a discriminated union.
 *
 * **The tabs are a NARROWER control than the context switcher above them, and the two answer
 * different questions.** `BillingContextSwitcher` chooses which ACCOUNT is billed (its `contextId`);
 * these tabs choose which legal identity SHAPE the invoice is drawn in (its `contextKind`), which is
 * what `missingBuyerFields` and the save both read. They are genuinely independent: a member paying
 * from a company account may still want a personal invoice, and a sole trader billing personally may
 * still need to put a VAT number on it. Deriving one from the other is how that becomes unfilable.
 *
 * **The three company identifiers are not interchangeable.** The legal name, the incorporation
 * number (CRN) and the tax registration (VAT / EIN) are three different facts on three different
 * columns; a company can hold a CRN and no VAT registration, so collapsing them into one field makes
 * a legitimate state unfilable.
 *
 * **Department allocation is a Select, and only when there is something to select.** An entity that
 * declares no departments renders no control at all rather than an empty dropdown that can never be
 * satisfied — absence is the honest form of "this does not apply".
 */

// #region Tab identity
/** The DOM id of one billing-shape tab. Shared by the tab and the panel it labels. */
export function billingTabId(scope: string, kind: BillingContextKind): string {
	return `${scope}-billing-tab-${kind}`;
}

/** The DOM id of the fields panel the tabs control. */
export function billingPanelId(scope: string): string {
	return `${scope}-billing-panel`;
}

/** The two shapes, in reading order. */
const KINDS: readonly { kind: BillingContextKind; label: string }[] = [
	{ kind: "personal", label: "Personal" },
	{ kind: "business", label: "Business" },
];
// #endregion

// #region Tabs
/** Props for {@link BillingKindTabs}. */
export interface BillingKindTabsProps {
	/** The draft whose `contextKind` these tabs move. */
	draft: DetailsDraft;
	/** Block the control while a save is in flight. */
	disabled?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}

/**
 * Which legal identity shape the billing form collects.
 *
 * A real `tablist`: the two blocks are panels of one region and exactly one is rendered, which is
 * precisely what the pattern describes. Arrow keys move between the tabs and selection follows
 * focus, so the keyboard behaviour matches what the visual grammar promises.
 *
 * Writes the shared {@link billingContextKind} signal alongside the draft, so the bands and the lane
 * — separate hydration roots that cannot see the draft — track the choice without a second read.
 */
export function BillingKindTabs(props: BillingKindTabsProps): JSX.Element {
	const { draft, disabled, scope = "cko-details" } = props;
	const active = draft.contextKind.value;

	const choose = (kind: BillingContextKind): void => {
		if (disabled) return;
		draft.contextKind.value = kind;
		billingContextKind.value = kind;
	};

	const move = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void => {
		const last = KINDS.length - 1;
		let next = index;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			next = index === last ? 0 : index + 1;
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			next = index === 0 ? last : index - 1;
		} else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = last;
		else return;
		event.preventDefault();
		const target = KINDS[next];
		choose(target.kind);
		document.getElementById(billingTabId(scope, target.kind))?.focus();
	};

	return (
		<div class="ckod-kindtabs" role="tablist" aria-label="Billing identity shape">
			{KINDS.map((entry, index) => {
				const selected = entry.kind === active;
				return (
					<button
						key={entry.kind}
						id={billingTabId(scope, entry.kind)}
						type="button"
						role="tab"
						class="ckod-kindtab"
						data-active={selected ? "true" : undefined}
						aria-selected={selected ? "true" : "false"}
						aria-controls={billingPanelId(scope)}
						// Roving tabindex: the strip is one tab stop, and the arrows move within it.
						tabIndex={selected ? 0 : -1}
						disabled={disabled}
						onClick={() => choose(entry.kind)}
						onKeyDown={(event) => move(event, index)}
					>
						{entry.label}
					</button>
				);
			})}
		</div>
	);
}
// #endregion

// #region Personal
/** Props shared by both billing blocks. */
export interface BillingBlockProps {
	draft: DetailsDraft;
	/** Block writes while a save is in flight. */
	disabled?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
	/**
	 * Whether a {@link BillingKindTabs} strip is mounted for this block.
	 *
	 * A `tabpanel` role is a claim that a `tab` labels it, so it is applied only where one exists.
	 * The modal renders these blocks with the context switcher and no tabs, and a panel pointing
	 * `aria-labelledby` at an id that is not on the page announces as an unlabelled region.
	 */
	tabbed?: boolean;
}

/** The panel's tab wiring, or nothing at all when no tab strip is mounted. */
function panelRole(
	scope: string,
	kind: BillingContextKind,
	tabbed: boolean | undefined,
): { id?: string; role?: "tabpanel"; "aria-labelledby"?: string } {
	if (!tabbed) return {};
	return {
		id: billingPanelId(scope),
		role: "tabpanel",
		"aria-labelledby": billingTabId(scope, kind),
	};
}

/** The natural-person invoice: who is billed, and where they are for tax purposes. */
export function PersonalBillingFields(props: BillingBlockProps): JSX.Element {
	const { draft, disabled, scope = "cko-details" } = props;
	return (
		<div class="ckod__grid" {...panelRole(scope, "personal", props.tabbed)}>
			<DetailsField
				draft={draft}
				path="personal.name"
				label="Name"
				value={draft.personal.name}
				required
				autoComplete="name"
				hint="As it appears on the card or account being billed."
				disabled={disabled}
				scope={props.scope}
				span="half"
			/>
			<PhoneField
				draft={draft}
				path="personal.phone"
				label="Mobile"
				value={draft.personal.phone}
				country={draft.personal.address.country}
				disabled={disabled}
				scope={props.scope}
				span="half"
			/>
			<DetailsField
				draft={draft}
				path="personal.email"
				label="Email"
				value={draft.personal.email}
				required
				email
				autoComplete="email"
				placeholder="name@example.com"
				disabled={disabled}
				scope={props.scope}
				span="full"
			/>
			<AddressFields
				draft={draft}
				address={draft.personal.address}
				prefix="personal.address"
				line1Label="Address"
				disabled={disabled}
				scope={props.scope}
			/>
		</div>
	);
}
// #endregion

// #region Business
/** Props for {@link BusinessBillingFields}. */
export interface BusinessBillingFieldsProps extends BillingBlockProps {
	/** The departments the selected identity declares; an empty list hides the control. */
	departments: readonly DepartmentOption[];
}

/** The company invoice: the legal identity, its two registrations, and where the spend lands. */
export function BusinessBillingFields(props: BusinessBillingFieldsProps): JSX.Element {
	const { draft, departments, disabled, scope = "cko-details" } = props;
	const departmentId = detailsFieldId("business.departmentId", props.scope);

	return (
		<div class="ckod__grid" {...panelRole(scope, "business", props.tabbed)}>
			<DetailsField
				draft={draft}
				path="business.companyName"
				label="Company Name"
				value={draft.business.companyName}
				required
				autoComplete="organization"
				hint="The registered legal name, not a trading name."
				disabled={disabled}
				scope={props.scope}
				span="third"
			/>
			<DetailsField
				draft={draft}
				path="business.registrationNumber"
				label="Company Registration Number"
				value={draft.business.registrationNumber}
				required
				hint="The incorporation number — a CRN in the UK, an EIN in the US."
				disabled={disabled}
				scope={props.scope}
				span="third"
			/>
			<DetailsField
				draft={draft}
				path="business.taxId"
				label="VAT ID"
				value={draft.business.taxId}
				required
				hint="Your tax registration. Separate from the registration number."
				disabled={disabled}
				scope={props.scope}
				span="third"
			/>
			<DetailsField
				draft={draft}
				path="business.corporateEmail"
				label="Email"
				value={draft.business.corporateEmail}
				required
				email
				autoComplete="email"
				placeholder="accounts@company.com"
				hint="Invoices and payment receipts are sent here."
				disabled={disabled}
				scope={props.scope}
				span="half"
			/>
			<PhoneField
				draft={draft}
				path="business.phone"
				label="Mobile"
				value={draft.business.phone}
				country={draft.business.address.country}
				required
				disabled={disabled}
				scope={props.scope}
				span="half"
			/>
			<AddressFields
				draft={draft}
				address={draft.business.address}
				prefix="business.address"
				line1Label="Address"
				disabled={disabled}
				scope={props.scope}
			/>
			{departments.length > 0
				? (
					<p class="ckod-field" data-span="full">
						<label class="ckod-field__label" for={departmentId}>
							Department or project scope
							<span class="ckod-field__opt">Optional</span>
						</label>
						<Select
							id={departmentId}
							size="sm"
							fluid
							showClear
							placeholder="Not allocated"
							value={draft.business.departmentId}
							options={departments.map((entry) => ({
								label: entry.label,
								value: entry.id,
							}))}
							disabled={disabled}
							aria-describedby={`${departmentId}-note`}
							onValueChange={() => markTouched(draft, "business.departmentId")}
						/>
						<span class="ckod-field__note" id={`${departmentId}-note`}>
							Which budget this purchase is attributed to on the invoice.
						</span>
					</p>
				)
				: null}
		</div>
	);
}
// #endregion

// #region Dispatcher
/** Props for {@link BillingFields}. */
export type BillingFieldsProps = BusinessBillingFieldsProps;

/**
 * Render whichever billing block the draft's active identity calls for.
 *
 * The active kind is read from the DRAFT rather than taken as a prop, so the tabs, the fields and
 * the payload that is eventually saved all read one value. Two copies of "which identity is this" is
 * how a form comes to save a company's VAT number against a personal invoice.
 */
export function BillingFields(props: BillingFieldsProps): JSX.Element {
	return props.draft.contextKind.value === "business"
		? <BusinessBillingFields {...props} />
		: <PersonalBillingFields {...props} />;
}
// #endregion
