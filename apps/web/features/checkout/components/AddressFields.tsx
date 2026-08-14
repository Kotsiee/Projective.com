import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	type AddressSignals,
	type DetailsDraft,
	detailsFieldId,
	fieldVerdict,
	isTouched,
	markTouched,
} from "../core/details-draft.ts";

/**
 * AddressFields — the six-line postal block, plus {@link DetailsField}, the one labelled text row
 * every control on `/checkout/details` is built from.
 *
 * The row lives here because it is the most primitive piece of the form and both the delivery and
 * the two billing blocks compose it; a second implementation of "label, control, message" is how one
 * field on a form comes to announce itself differently from the one beside it.
 *
 * **Labelling.** Every label is a real `<label for>` bound by id to its control, and no control
 * carries an `aria-label` that would replace those visible words with a different string — the WCAG
 * 2.5.3 "label in name" failure `CatalogueCreateModal` shipped, where speech control could not
 * activate a field by the name printed on it.
 *
 * **Validation.** `status="invalid"` — and therefore `aria-invalid` — appears only once the field has
 * been touched. `status="required"` is never used: it also sets `aria-invalid`, so an empty field
 * would announce itself as wrong before anything had been typed. The message carries `role="alert"`
 * because it appears in response to something the reader just did.
 *
 * **`state` and `line2` are genuinely optional** and say so, rather than being silently accepted and
 * then refused by a payment processor that needed a US state.
 *
 * **Width is a SPAN, not a boolean.** The grid runs twelve tracks, so a row asks for a half (six), a
 * third (four) or the whole width (twelve) — which is what lets City / State / Postcode sit three
 * across without a second grid nested inside the first. `wide` survives as the alias for `full`, so
 * the callers that pre-date the ramp keep working unchanged.
 *
 * **A full-width row may still be capped.** `cap` holds a control to `--field-max` (28rem) inside a
 * twelve-track row: an email or a country is a short value, and a text input stretched to 44rem
 * invites the reader to expect one. It is a MEASURE on a field, never on a figure — the rule
 * Decision #60 draws around amounts, charts and tables does not reach a column of text inputs.
 */

// #region Shared field row
/** How many of the grid's twelve tracks a field row occupies. */
export type DetailsFieldSpan = "third" | "half" | "full";

/** Props for {@link DetailsField}. */
export interface DetailsFieldProps {
	/** The draft this control belongs to — the touch ledger and the verdict both read from it. */
	draft: DetailsDraft;
	/** The dotted SSOT path (`business.address.city`). Doubles as the control's identity. */
	path: string;
	/** The visible label. Also the accessible name, unchanged. */
	label: string;
	/** The bound value. */
	value: Signal<string>;
	/** Whether the SSOT requires this field for the active billing identity. */
	required?: boolean;
	/** Validate as an email address against the SSOT's own schema. */
	email?: boolean;
	/** Native input type (`tel`, `email`, …). */
	type?: string;
	/** Browser autofill hint. */
	autoComplete?: string;
	/** Standing help text, described rather than announced (it is present on first paint). */
	hint?: string;
	placeholder?: string;
	/** Block writes while a save is in flight. */
	disabled?: boolean;
	/** How much of the twelve-track grid this row occupies. Defaults to a half. */
	span?: DetailsFieldSpan;
	/** Span the full width. The pre-ramp spelling of `span="full"`. */
	wide?: boolean;
	/** Hold the control to `--field-max` within its span — for short values on a wide row. */
	cap?: boolean;
	/** Id scope, so the page form and the modal never mint the same ids. */
	scope?: string;
}

/** The track count a row asks for, resolving the legacy `wide` alias. */
function spanOf(props: Pick<DetailsFieldProps, "span" | "wide">): DetailsFieldSpan {
	if (props.span) return props.span;
	return props.wide ? "full" : "half";
}

/** One labelled text control with its verdict — the atom of this form. */
export function DetailsField(props: DetailsFieldProps): JSX.Element {
	const { draft, path, label, value, required, email, hint, scope } = props;
	const id = detailsFieldId(path, scope);
	const noteId = `${id}-note`;

	const verdict = fieldVerdict({
		value: value.value,
		label,
		touched: isTouched(draft, path),
		required,
		email,
	});
	const note = verdict.message ?? hint ?? null;

	return (
		<p class="ckod-field" data-span={spanOf(props)} data-cap={props.cap ? "true" : undefined}>
			<label class="ckod-field__label" for={id}>
				{label}
				{required
					? <span class="ckod-field__req" aria-hidden="true">*</span>
					: <span class="ckod-field__opt">Optional</span>}
			</label>
			<InputText
				id={id}
				size="md"
				fluid
				type={props.type ?? (email ? "email" : "text")}
				autoComplete={props.autoComplete}
				placeholder={props.placeholder}
				value={value}
				disabled={props.disabled}
				status={verdict.status}
				aria-describedby={note ? noteId : undefined}
				onBlur={() => markTouched(draft, path)}
			/>
			{
				/*
				 * The note row is rendered whether or not it has anything to say, and reserves its height
				 * from `--fld-hint-min-h`. A message that appears only when it has content pushes its
				 * whole grid row — and therefore the rest of the form — down at the exact moment the
				 * reader is being asked to look at something.
				 */
			}
			{verdict.message
				? (
					<span class="ckod-field__note ckod-field__note--error" id={noteId} role="alert">
						<Icon name="error" size="2xs" />
						{verdict.message}
					</span>
				)
				: <span class="ckod-field__note" id={noteId}>{hint}</span>}
		</p>
	);
}
// #endregion

// #region Address block
/** Props for {@link AddressFields}. */
export interface AddressFieldsProps {
	draft: DetailsDraft;
	/** The address block's own signals. */
	address: AddressSignals;
	/** Path prefix (`personal.address` · `business.address`). */
	prefix: string;
	/** Label for the first line — "Address" personally, "Registered address" for a company. */
	line1Label: string;
	disabled?: boolean;
	scope?: string;
}

/**
 * The postal address block.
 *
 * Six bounded fields rather than one free-text blob: an address that arrives as a single string
 * cannot be validated, cannot be handed to a tax engine, and cannot be corrected line by line.
 *
 * The two street lines take the full width because an address line is long; City / State / Postcode
 * take a third each because they are short and are read as one row. **Country is kept and is not
 * part of that three-across row** — it is required by `missingBuyerFields` for both identities and
 * it is what seeds the phone field's dial code, so dropping it to make the row tidy would make the
 * form unfilable. It takes its own row, capped like the other short values, rather than squeezing a
 * fourth column into a row the design draws as three.
 */
export function AddressFields(props: AddressFieldsProps): JSX.Element {
	const { draft, address, prefix, disabled, scope } = props;
	return (
		<>
			<DetailsField
				draft={draft}
				path={`${prefix}.line1`}
				label={props.line1Label}
				value={address.line1}
				required
				autoComplete="address-line1"
				disabled={disabled}
				scope={scope}
				span="full"
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.line2`}
				label="Apartment, suite, floor"
				value={address.line2}
				autoComplete="address-line2"
				disabled={disabled}
				scope={scope}
				span="full"
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.city`}
				label="City"
				value={address.city}
				required
				autoComplete="address-level2"
				disabled={disabled}
				scope={scope}
				span="third"
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.state`}
				label="State"
				value={address.state}
				autoComplete="address-level1"
				hint="Required in some countries, including the US."
				disabled={disabled}
				scope={scope}
				span="third"
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.postcode`}
				label="Postcode / Zip code"
				value={address.postcode}
				required
				autoComplete="postal-code"
				disabled={disabled}
				scope={scope}
				span="third"
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.country`}
				label="Country"
				value={address.country}
				required
				autoComplete="country-name"
				placeholder="GB"
				disabled={disabled}
				scope={scope}
				span="full"
				cap
			/>
		</>
	);
}
// #endregion
