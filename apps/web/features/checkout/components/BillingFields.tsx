import type { JSX } from "preact";
import { Select } from "@projective/ui/fields";
import {
	type DepartmentOption,
	type DetailsDraft,
	detailsFieldId,
	markTouched,
} from "../core/details-draft.ts";
import { AddressFields, DetailsField } from "./AddressFields.tsx";
import { PhoneField } from "./PhoneField.tsx";

/**
 * BillingFields — the invoiced identity: a natural person's block, or a company's.
 *
 * **Which one renders is decided by the entity chip row, and by nothing else.** This file used to
 * export a second control — an underlined personal/business tab strip that sat inside the Billing
 * section — and the form therefore asked the same question twice, in two places, with two different
 * answers possible. Picking a company in the chip row now IS choosing the company invoice, and the
 * registration and VAT rows appear with it.
 *
 * **Both blocks exist in the draft at all times; only one is rendered.** Switching discards nothing —
 * the record carries both, so a buyer who fills the company form, returns to Personal to correct a
 * spelling and comes back finds their work where they left it. That is the whole reason
 * `BuyerDetailsSchema` is not a discriminated union.
 *
 * **The three company identifiers are not interchangeable.** The legal name, the incorporation
 * number (CRN) and the tax registration (VAT / EIN) are three different facts on three different
 * columns; a company can hold a CRN and no VAT registration, so collapsing them into one field makes
 * a legitimate state unfilable. Only the name is ever pre-filled from the chosen entity — a plausible
 * looking registration number nobody entered is worse than an empty one that asks.
 *
 * **Department allocation is a Select, and only when there is something to select.** An entity that
 * declares no departments renders no control at all rather than an empty dropdown that can never be
 * satisfied — absence is the honest form of "this does not apply".
 */

// #region Personal
/** Props shared by both billing blocks. */
export interface BillingBlockProps {
	draft: DetailsDraft;
	/** Block writes while a save is in flight. */
	disabled?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}

/** The natural-person invoice: who is billed, and where they are for tax purposes. */
export function PersonalBillingFields(props: BillingBlockProps): JSX.Element {
	const { draft, disabled } = props;
	return (
		<div class="ckod__grid">
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
				cap
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

/**
 * The company invoice: the legal identity, its two registrations, and where the spend lands.
 *
 * The registration and VAT rows share one row directly beneath the company name, because they are
 * read together as "who this company is on paper" and both are answered from the same document.
 */
export function BusinessBillingFields(props: BusinessBillingFieldsProps): JSX.Element {
	const { draft, departments, disabled } = props;
	const departmentId = detailsFieldId("business.departmentId", props.scope);

	return (
		<div class="ckod__grid">
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
			<DetailsField
				draft={draft}
				path="business.registrationNumber"
				label="Company Registration Number"
				value={draft.business.registrationNumber}
				required
				hint="The incorporation number — a CRN in the UK, an EIN in the US."
				disabled={disabled}
				scope={props.scope}
				span="half"
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
				span="half"
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
				span="full"
				cap
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
					<p class="ckod-field" data-span="full" data-cap="true">
						<label class="ckod-field__label" for={departmentId}>
							Department or project scope
							<span class="ckod-field__opt">Optional</span>
						</label>
						<Select
							id={departmentId}
							size="md"
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
 * The active kind is read from the DRAFT rather than taken as a prop, so the chip row, the fields
 * and the payload that is eventually saved all read one value. Two copies of "which identity is
 * this" is how a form comes to save a company's VAT number against a personal invoice.
 */
export function BillingFields(props: BillingFieldsProps): JSX.Element {
	return props.draft.contextKind.value === "business"
		? <BusinessBillingFields {...props} />
		: <PersonalBillingFields {...props} />;
}
// #endregion
