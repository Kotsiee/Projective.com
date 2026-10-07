import type { JSX } from "preact";
import { Select } from "@projective/ui/fields";
import {
	type DepartmentOption,
	type DetailsDraft,
	detailsFieldId,
	markTouched,
} from "../core/details-draft.ts";
import { AddressFields, DetailsField, DetailsLabel } from "./AddressFields.tsx";
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
 * looking registration number nobody entered is worse than an empty one that asks. The two numbers
 * keep their hints, because those two are the pair a buyer confuses; every other field's meaning now
 * lives in its label rather than in a standing line beneath it.
 *
 * **Rows are track sums** on the twelve-track grid (see `AddressFields`): personally `4 + 4 + 4`
 * (name · email · mobile) then the address; for a company `8 + 4`, `6 + 6`, `8 + 4`, then the
 * address. The department picker sits beside the invoice email rather than after the address, so
 * the address's last field is the form's last field and Enter on it submits.
 *
 * **Department allocation is a Select, and only when there is something to select.** An entity that
 * declares no departments renders no control at all rather than an empty dropdown that can never be
 * satisfied — absence is the honest form of "this does not apply".
 */

// #region Personal
/** Props shared by both billing blocks. */
export interface BillingBlockProps {
	draft: DetailsDraft;
	/** A save is in flight: the controls turn read-only and keep focus. */
	busy?: boolean;
	/** Id scope, so a modal copy of this form never mints the same ids as the page. */
	scope?: string;
}

/** The natural-person invoice: who is billed, and where they are for tax purposes. */
export function PersonalBillingFields(props: BillingBlockProps): JSX.Element {
	const { draft, busy } = props;
	return (
		<div class="ckod__grid">
			<DetailsField
				draft={draft}
				path="personal.name"
				label="Name on the invoice"
				value={draft.personal.name}
				required
				autoComplete="name"
				busy={busy}
				scope={props.scope}
				span={4}
			/>
			<DetailsField
				draft={draft}
				path="personal.email"
				label="Billing email"
				value={draft.personal.email}
				required
				email
				autoComplete="email"
				placeholder="name@example.com"
				busy={busy}
				scope={props.scope}
				span={4}
			/>
			<PhoneField
				draft={draft}
				path="personal.phone"
				label="Mobile"
				value={draft.personal.phone}
				country={draft.personal.address.country}
				busy={busy}
				scope={props.scope}
				span={4}
			/>
			<AddressFields
				draft={draft}
				address={draft.personal.address}
				prefix="personal.address"
				line1Label="Address"
				busy={busy}
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
	const { draft, departments, busy } = props;
	const departmentId = detailsFieldId("business.departmentId", props.scope);

	return (
		<div class="ckod__grid">
			<DetailsField
				draft={draft}
				path="business.companyName"
				label="Registered company name"
				value={draft.business.companyName}
				required
				autoComplete="organization"
				busy={busy}
				scope={props.scope}
				span={8}
			/>
			<PhoneField
				draft={draft}
				path="business.phone"
				label="Mobile"
				value={draft.business.phone}
				country={draft.business.address.country}
				required
				busy={busy}
				scope={props.scope}
				span={4}
			/>
			<DetailsField
				draft={draft}
				path="business.registrationNumber"
				label="Company registration number"
				value={draft.business.registrationNumber}
				required
				hint="The incorporation number — a CRN in the UK, an EIN in the US."
				busy={busy}
				scope={props.scope}
				span={6}
			/>
			<DetailsField
				draft={draft}
				path="business.taxId"
				label="VAT ID"
				value={draft.business.taxId}
				required
				hint="The tax registration — separate from the registration number."
				busy={busy}
				scope={props.scope}
				span={6}
			/>
			<DetailsField
				draft={draft}
				path="business.corporateEmail"
				label="Invoice email"
				value={draft.business.corporateEmail}
				required
				email
				autoComplete="email"
				placeholder="accounts@company.com"
				busy={busy}
				scope={props.scope}
				span={8}
			/>
			{departments.length > 0
				? (
					<p
						class="ckod-field"
						data-span={4}
						data-filled={draft.business.departmentId.value ? "true" : "false"}
					>
						<DetailsLabel for={departmentId} label="Department" />
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
							readOnly={busy}
							onValueChange={() => markTouched(draft, "business.departmentId")}
						/>
					</p>
				)
				: null}
			<AddressFields
				draft={draft}
				address={draft.business.address}
				prefix="business.address"
				line1Label="Registered address"
				busy={busy}
				scope={props.scope}
			/>
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
