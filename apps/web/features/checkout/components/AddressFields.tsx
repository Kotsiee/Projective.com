import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { COUNTRIES, countryCodeOf, countryNeedsRegion } from "@projective/types/finance";
import { InputText, Select } from "@projective/ui/fields";
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
 * AddressFields — the postal block, plus {@link DetailsField}, the one labelled text row every
 * control on `/checkout/details` is built from, and {@link CountryField}, the searchable country
 * picker that row's address ends on.
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
 * **Width is a TRACK COUNT on a twelve-track grid** (12 · 8 · 6 · 5 · 4 · 3), so a row is written
 * as the sum it is — `8 + 4` for a street line beside its apartment line, `5 + 3 + 4` for City,
 * Postcode and Country — rather than as names that each meant a different width at each breakpoint.
 * Below the form's widest container every row that is not full width halves, so a pair stays a pair
 * and a triple wraps its last field onto a new row rather than shrinking a postcode below its value.
 *
 * **The note row exists only when it has something to say** (Decision #153). It used to reserve
 * `--fld-hint-min-h` under every control, which cost the form a blank 20px band per row — the single
 * largest reason the step scrolled. A validation message now grows its row when it appears.
 *
 * **Busy is read-only, never disabled.** While a save is in flight every control is `readOnly` and
 * `aria-busy`: a `disabled` control drops focus to `<body>`, so a buyer who submitted from the
 * keyboard was left with no position at all at the moment the page was working for them.
 */

// #region Shared field row
/** How many of the grid's twelve tracks a field row occupies at the form's full width. */
export type DetailsFieldSpan = 3 | 4 | 5 | 6 | 8 | 12;

/** The virtual keyboard's Enter label — `next` walks the form, `go` submits it. */
export type DetailsEnterHint = "next" | "go";

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
	/** Standing help text, described rather than announced. Rendered only when given. */
	hint?: string;
	placeholder?: string;
	/** A save is in flight: the control turns read-only and busy, and KEEPS focus. */
	busy?: boolean;
	/** How much of the twelve-track grid this row occupies. Defaults to six. */
	span?: DetailsFieldSpan;
	/** The virtual keyboard's Enter label. Defaults to `next`. */
	enterKeyHint?: DetailsEnterHint;
	/** Id scope, so the page form and the modal never mint the same ids. */
	scope?: string;
}

/** The label row shared by every control on the step: the words, then required or optional. */
export function DetailsLabel(
	props: { for: string; label: string; required?: boolean },
): JSX.Element {
	return (
		<label class="ckod-field__label" for={props.for}>
			{props.label}
			{props.required
				? <span class="ckod-field__req" aria-hidden="true">*</span>
				: <span class="ckod-field__opt">Optional</span>}
		</label>
	);
}

/**
 * The note under a control — its verdict when it has one, else its standing hint, else NOTHING.
 *
 * Rendered only with content (see the module note); the id is stable either way so the control's
 * `aria-describedby` can be set exactly when a note exists.
 */
export function DetailsNote(
	props: { id: string; message: string | null; hint?: string },
): JSX.Element | null {
	if (props.message) {
		return (
			<span class="ckod-field__note ckod-field__note--error" id={props.id} role="alert">
				<Icon name="error" size="2xs" />
				{props.message}
			</span>
		);
	}
	return props.hint ? <span class="ckod-field__note" id={props.id}>{props.hint}</span> : null;
}

/** One labelled text control with its verdict — the atom of this form. */
export function DetailsField(props: DetailsFieldProps): JSX.Element {
	const { draft, path, label, value, required, email, hint, scope, busy } = props;
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
		<p class="ckod-field" data-span={props.span ?? 6}>
			<DetailsLabel for={id} label={label} required={required} />
			<InputText
				id={id}
				size="md"
				fluid
				type={props.type ?? (email ? "email" : "text")}
				autoComplete={props.autoComplete}
				placeholder={props.placeholder}
				value={value}
				readOnly={busy}
				aria-busy={busy || undefined}
				enterKeyHint={props.enterKeyHint ?? "next"}
				status={verdict.status}
				aria-describedby={note ? noteId : undefined}
				onBlur={() => markTouched(draft, path)}
			/>
			<DetailsNote id={noteId} message={verdict.message} hint={hint} />
		</p>
	);
}
// #endregion

// #region Country
/** Props for {@link CountryField}. */
export interface CountryFieldProps {
	draft: DetailsDraft;
	/** The dotted SSOT path (`personal.address.country`). */
	path: string;
	/** The bound value — what the SSOT stores, which a pre-select record may hold as a NAME. */
	value: Signal<string>;
	required?: boolean;
	busy?: boolean;
	span?: DetailsFieldSpan;
	scope?: string;
}

/** Every country as a select option. Built once — the list never changes at run time. */
const COUNTRY_OPTIONS = COUNTRIES.map((country) => ({ label: country.name, value: country.code }));

/**
 * The address country as a searchable list of ISO 3166-1 codes.
 *
 * **What is stored is what was saved until the buyer picks.** Records pre-dating this control hold
 * free text ("Brazil", "uk"). The control SHOWS the matching country by normalising through
 * `countryCodeOf`, but writes nothing until the buyer chooses — a mount that rewrote the value would
 * mark the form dirty before anyone touched it (the rule {@link PhoneField} states for the same
 * reason). A saved value the list does not recognise is kept as an option of its own, so it is still
 * visible and still submits rather than being replaced with a guess.
 *
 * The wrapper carries `data-filled`: Enter on a filled picker walks on to the next field, Enter on an
 * empty one opens it (see `details-keys.ts`).
 */
export function CountryField(props: CountryFieldProps): JSX.Element {
	const { draft, path, value, required, busy, scope } = props;
	const id = detailsFieldId(path, scope);
	const noteId = `${id}-note`;

	const shown = useSignal(countryCodeOf(value.peek()) ?? value.peek());
	// Follow an external re-seed (a save adopting the server's record) without ever writing back.
	useSignalEffect(() => {
		const raw = value.value;
		const next = countryCodeOf(raw) ?? raw;
		if (next !== shown.peek()) shown.value = next;
	});

	const raw = value.value;
	const known = countryCodeOf(raw) !== null;
	const options = known || raw.trim() === ""
		? COUNTRY_OPTIONS
		: [{ label: raw, value: raw }, ...COUNTRY_OPTIONS];

	const verdict = fieldVerdict({
		value: raw,
		label: "Country",
		touched: isTouched(draft, path),
		required,
	});

	return (
		<p
			class="ckod-field ckod-field--country"
			data-span={props.span ?? 4}
			data-filled={raw.trim() !== "" ? "true" : "false"}
		>
			<DetailsLabel for={id} label="Country" required={required} />
			<Select
				id={id}
				size="md"
				fluid
				filter
				filterPlaceholder="Search countries"
				placeholder="Choose a country"
				value={shown}
				options={options}
				readOnly={busy}
				required={required}
				status={verdict.status}
				aria-describedby={verdict.message ? noteId : undefined}
				onValueChange={(next) => {
					const chosen = Array.isArray(next) ? next[0] ?? "" : next;
					if (!chosen) return;
					value.value = chosen;
					markTouched(draft, path);
				}}
			/>
			<DetailsNote id={noteId} message={verdict.message} />
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
	busy?: boolean;
	scope?: string;
}

/**
 * The postal address block.
 *
 * Bounded fields rather than one free-text blob: an address that arrives as a single string cannot
 * be validated, cannot be handed to a tax engine, and cannot be corrected line by line.
 *
 * Two rows: the street line beside the short apartment line (`8 + 4`), then City · Postcode · Country
 * (`5 + 3 + 4`). DOM order is reading order, so Tab and Enter walk them left to right.
 *
 * **Country is kept** — it is required by `missingBuyerFields` for both identities and it is what
 * seeds the phone field's dial code, so dropping it would make the form unfilable.
 *
 * **State appears where it means something** — after Country, once a country whose addresses carry a
 * state or province is chosen (`countryNeedsRegion`), or whenever a value is already saved, so a
 * stored state is never hidden. It stays optional, exactly as the SSOT says; showing it is not the
 * same as requiring it.
 */
export function AddressFields(props: AddressFieldsProps): JSX.Element {
	const { draft, address, prefix, busy, scope } = props;
	const showsState = countryNeedsRegion(address.country.value) || address.state.value.trim() !== "";
	return (
		<>
			<DetailsField
				draft={draft}
				path={`${prefix}.line1`}
				label={props.line1Label}
				value={address.line1}
				required
				autoComplete="address-line1"
				busy={busy}
				scope={scope}
				span={8}
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.line2`}
				label="Apt, suite, floor"
				value={address.line2}
				autoComplete="address-line2"
				busy={busy}
				scope={scope}
				span={4}
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.city`}
				label="City"
				value={address.city}
				required
				autoComplete="address-level2"
				busy={busy}
				scope={scope}
				span={5}
			/>
			<DetailsField
				draft={draft}
				path={`${prefix}.postcode`}
				label="Postcode / ZIP"
				value={address.postcode}
				required
				autoComplete="postal-code"
				busy={busy}
				scope={scope}
				span={3}
			/>
			<CountryField
				draft={draft}
				path={`${prefix}.country`}
				value={address.country}
				required
				busy={busy}
				scope={scope}
				span={4}
			/>
			{showsState
				? (
					<DetailsField
						draft={draft}
						path={`${prefix}.state`}
						label="State / province"
						value={address.state}
						autoComplete="address-level1"
						busy={busy}
						scope={scope}
						span={4}
						enterKeyHint="go"
					/>
				)
				: null}
		</>
	);
}
// #endregion
