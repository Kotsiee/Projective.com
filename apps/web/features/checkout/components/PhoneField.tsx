import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { InputText, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	type DetailsDraft,
	detailsFieldId,
	fieldVerdict,
	isTouched,
	markTouched,
} from "../core/details-draft.ts";
import type { DetailsFieldSpan } from "./AddressFields.tsx";

/**
 * PhoneField — a country dial-code prefix joined to a national number, rendering as one control
 * (`🇬🇧 +44 | 12456789`) while remaining two real, separately-operable controls.
 *
 * ## The list is a convenience, not a directory
 *
 * {@link DIAL_CODES} is a SHORT set of the countries this checkout actually sees. It is deliberately
 * not a complete ITU table: a full list belongs in a shared reference module with its own tests, and
 * shipping a partial one under a name that implies completeness is how a surface comes to be trusted
 * for something it cannot answer. A buyer outside the list keeps whatever they type — see
 * {@link joinPhone}.
 *
 * ## The flag carries nothing
 *
 * It is `aria-hidden` decoration. The dial code and the country NAME carry the meaning, exactly as
 * the display-currency picker treats `DISPLAY_CURRENCIES`' flags — a flag is neither a language, a
 * dialling plan, nor a string assistive tech reads usefully.
 *
 * ## Nothing is written on mount
 *
 * The SSOT stores ONE phone string, so this control splits it for display and rejoins it on input.
 * The rejoin happens only in response to a keystroke or a selection — never from a mount effect —
 * because a draft that rewrote its own value on first paint would mark the form dirty before the
 * buyer had touched it, and the footer would then offer to save an edit nobody made.
 *
 * A stored value with no recognised `+dial` prefix is left exactly as stored ({@link
 * PhoneParts.hasDial} is `false`) until the buyer picks a country, so this control can never
 * silently prepend a code onto a number that already carried its own.
 */

// #region Dial codes
/** One selectable dialling country. */
export interface DialCode {
	/** ISO 3166-1 alpha-2. The option VALUE, so `+1` can be two distinct choices. */
	iso: string;
	/** Decorative only — never the accessible name. */
	flag: string;
	/** E.164 country calling code, with its leading `+`. */
	dial: string;
	/** The country name. This, with {@link dial}, is what the option actually means. */
	name: string;
}

/**
 * The countries this checkout offers a prefix for.
 *
 * Order is load-bearing in exactly one place: `+1` is shared by the United States and Canada, and
 * {@link splitPhone} resolves that tie by list order, so a stored `+1` number reads back as US.
 */
export const DIAL_CODES: readonly DialCode[] = [
	{ iso: "GB", flag: "🇬🇧", dial: "+44", name: "United Kingdom" },
	{ iso: "IE", flag: "🇮🇪", dial: "+353", name: "Ireland" },
	{ iso: "US", flag: "🇺🇸", dial: "+1", name: "United States" },
	{ iso: "CA", flag: "🇨🇦", dial: "+1", name: "Canada" },
	{ iso: "AU", flag: "🇦🇺", dial: "+61", name: "Australia" },
	{ iso: "NZ", flag: "🇳🇿", dial: "+64", name: "New Zealand" },
	{ iso: "DE", flag: "🇩🇪", dial: "+49", name: "Germany" },
	{ iso: "FR", flag: "🇫🇷", dial: "+33", name: "France" },
	{ iso: "ES", flag: "🇪🇸", dial: "+34", name: "Spain" },
	{ iso: "NL", flag: "🇳🇱", dial: "+31", name: "Netherlands" },
	{ iso: "IN", flag: "🇮🇳", dial: "+91", name: "India" },
	{ iso: "AE", flag: "🇦🇪", dial: "+971", name: "United Arab Emirates" },
];

/** The prefix used when the address names no country this list knows. */
export const DEFAULT_DIAL_ISO = "GB";

/** The entry for an ISO code, falling back to {@link DEFAULT_DIAL_ISO} rather than to nothing. */
export function dialCodeOf(iso: string): DialCode {
	return DIAL_CODES.find((entry) => entry.iso === iso.toUpperCase()) ??
		DIAL_CODES.find((entry) => entry.iso === DEFAULT_DIAL_ISO) as DialCode;
}

/**
 * Resolve the prefix a country field implies.
 *
 * The address country is free text, so both the ISO code and the written name are accepted; anything
 * else defaults rather than guessing, because a wrong dial code on a real number is worse than a
 * default the buyer can see and change.
 */
export function isoForCountry(country: string | undefined): string {
	const value = (country ?? "").trim().toUpperCase();
	if (value === "") return DEFAULT_DIAL_ISO;
	const match = DIAL_CODES.find(
		(entry) => entry.iso === value || entry.name.toUpperCase() === value,
	);
	return match?.iso ?? DEFAULT_DIAL_ISO;
}
// #endregion

// #region Split and join
/** A phone number as the two controls hold it. */
export interface PhoneParts {
	iso: string;
	/** Everything after the dial code — what the number input shows. */
	national: string;
	/** Whether the stored value actually carried a recognised dial code. */
	hasDial: boolean;
}

/**
 * Split a stored value into a prefix and a national number.
 *
 * Longest dial code first, so a shorter code that happens to be a prefix of a longer one can never
 * swallow it.
 */
export function splitPhone(raw: string, fallbackIso: string): PhoneParts {
	const value = raw.trim();
	if (value.startsWith("+")) {
		const byLength = [...DIAL_CODES].sort((a, b) => b.dial.length - a.dial.length);
		for (const entry of byLength) {
			if (value.startsWith(entry.dial)) {
				return {
					iso: entry.iso,
					national: value.slice(entry.dial.length).trim(),
					hasDial: true,
				};
			}
		}
	}
	return { iso: fallbackIso, national: value, hasDial: false };
}

/**
 * Rejoin the two controls into the one string the SSOT stores.
 *
 * An empty national number yields an empty string rather than a bare `+44`: an optional phone the
 * buyer left alone must stay genuinely empty, or `missingBuyerFields` and the invoice would both
 * read a dial code as a phone number.
 */
export function joinPhone(parts: PhoneParts): string {
	const national = parts.national.trim();
	if (national === "") return "";
	if (!parts.hasDial) return national;
	return `${dialCodeOf(parts.iso).dial} ${national}`;
}
// #endregion

// #region Props
/** Props for {@link PhoneField}. */
export interface PhoneFieldProps {
	/** The draft this control belongs to — the touch ledger and the verdict both read from it. */
	draft: DetailsDraft;
	/** The dotted SSOT path (`personal.phone`). Doubles as the control's identity. */
	path: string;
	/** The visible label, bound by id to the NUMBER input. */
	label: string;
	/** The bound value — one string, exactly as the SSOT carries it. */
	value: Signal<string>;
	/** The address country for this billing block; seeds the prefix when it names a known country. */
	country?: Signal<string>;
	/** Whether the SSOT requires this field for the active billing identity. */
	required?: boolean;
	/** Standing help text, described rather than announced. */
	hint?: string;
	/** Block writes while a save is in flight. */
	disabled?: boolean;
	/** How many of the grid's six tracks this row occupies. */
	span?: DetailsFieldSpan;
	/** Id scope, so the page form and the modal never mint the same ids. */
	scope?: string;
}
// #endregion

// #region Render
/** One dial option, as a row. Compact form drops the country name for the closed trigger. */
function dialRow(iso: string, compact: boolean): JSX.Element {
	const entry = dialCodeOf(iso);
	return (
		<span class="ckod-dial">
			<span class="ckod-dial__flag" aria-hidden="true">{entry.flag}</span>
			<span class="ckod-dial__code">{entry.dial}</span>
			{compact ? null : <span class="ckod-dial__name">{entry.name}</span>}
		</span>
	);
}

/** A dial-code prefix joined to a national number. */
export function PhoneField(props: PhoneFieldProps): JSX.Element {
	const { draft, path, label, value, required, hint, disabled, scope } = props;
	const id = detailsFieldId(path, scope);
	const dialId = `${id}-dial`;
	const noteId = `${id}-note`;

	// Seeded once. `useSignal` memoises, and the field primitives bind a signal identity rather than a
	// value, so rebuilding these per render would hand both controls a signal nothing writes to.
	const seed = splitPhone(value.peek(), isoForCountry(props.country?.peek()));
	const iso = useSignal(seed.iso);
	const national = useSignal(seed.national);
	const hasDial = useSignal(seed.hasDial);

	/*
	 * Follow an external re-seed — a save adopting the server's record, or a dev-seam refetch — without
	 * ever writing BACK. The guard makes this a no-op for the value this control itself just published,
	 * so the two directions cannot chase each other.
	 */
	useSignalEffect(() => {
		const raw = value.value;
		const held: PhoneParts = {
			iso: iso.peek(),
			national: national.peek(),
			hasDial: hasDial.peek(),
		};
		if (raw === joinPhone(held)) return;
		const next = splitPhone(raw, held.iso);
		iso.value = next.iso;
		national.value = next.national;
		hasDial.value = next.hasDial;
	});

	/** Write the rejoined string into the draft. Called only from a user gesture. */
	const publish = (): void => {
		value.value = joinPhone({
			iso: iso.peek(),
			national: national.peek(),
			hasDial: hasDial.peek(),
		});
	};

	const verdict = fieldVerdict({
		value: value.value,
		label,
		touched: isTouched(draft, path),
		required,
	});
	const note = verdict.message ?? hint ?? null;

	return (
		<p class="ckod-field ckod-field--phone" data-span={props.span ?? "half"}>
			<label class="ckod-field__label" for={id}>
				{label}
				{required
					? <span class="ckod-field__req" aria-hidden="true">*</span>
					: <span class="ckod-field__opt">Optional</span>}
			</label>

			{
				/*
				 * Two controls, one field. The visible label names the NUMBER — the thing the buyer types —
				 * and the selector carries its own accessible name, because "Mobile" would be a second,
				 * wrong name for a country picker.
				 */
			}
			<span class="ckod-phone">
				<Select
					class="ckod-phone__dial"
					id={dialId}
					size="sm"
					aria-label="Country dialling code"
					value={iso}
					disabled={disabled}
					options={DIAL_CODES.map((entry) => ({
						// The plain, matchable text: what typeahead searches and what is read aloud. The
						// templates below are presentation only.
						label: `${entry.name} ${entry.dial}`,
						value: entry.iso,
					}))}
					valueTemplate={(opt) => dialRow(String(opt.value), true)}
					optionTemplate={(opt) => dialRow(String(opt.value), false)}
					onValueChange={(next) => {
						const chosen = Array.isArray(next) ? next[0] ?? "" : next;
						if (!chosen) return;
						iso.value = chosen;
						// Choosing a country is the buyer stating their dial code, so it now travels with
						// the number even if the stored value never carried one.
						hasDial.value = true;
						publish();
						markTouched(draft, path);
					}}
				/>
				<InputText
					class="ckod-phone__number"
					id={id}
					size="sm"
					fluid
					type="tel"
					autoComplete="tel-national"
					placeholder="12456789"
					value={national}
					disabled={disabled}
					status={verdict.status}
					aria-describedby={note ? noteId : undefined}
					onValueChange={() => publish()}
					onBlur={() => markTouched(draft, path)}
				/>
			</span>

			{verdict.message
				? (
					<span class="ckod-field__note ckod-field__note--error" id={noteId} role="alert">
						<Icon name="error" size="2xs" />
						{verdict.message}
					</span>
				)
				: hint
				? <span class="ckod-field__note" id={noteId}>{hint}</span>
				: null}
		</p>
	);
}
// #endregion
