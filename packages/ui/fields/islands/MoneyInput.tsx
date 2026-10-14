import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/field.css";
import "../styles/input.css";
import "../styles/money-input.css";
import { cx } from "../../core/cx.ts";
import { displayLocale } from "../../display/core/currency-store.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import {
	clampMinor,
	currencyAdornment,
	formatMoneyInput,
	parseMoneyInput,
} from "../core/money-input.ts";
import { BusyMark, FieldMark } from "../components/field-marks.tsx";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

/** Props for {@link MoneyInput}. */
export interface MoneyInputProps extends BaseFieldProps {
	/** The amount in MINOR units (pence, cents, yen), or `null` for empty. */
	value?: Bindable<number | null>;
	/** Fired with minor units as the reader types (unclamped) and again, clamped, on blur. */
	onValueChange?: ValueChange<number | null>;
	/** ISO 4217 code; decides the decimals and the adornment. */
	currency: string;
	/** Lowest amount in minor units (default 0). */
	min?: number;
	/** Highest amount in minor units. */
	max?: number;
	/** Locale for separators and grouping (default: the display locale). */
	locale?: string;
	placeholder?: string;
	variant?: FieldVariant;
	onBlur?: JSX.FocusEventHandler<HTMLInputElement>;
	class?: string;
}

/**
 * MoneyInput — an amount field that speaks minor units.
 *
 * `inputmode="decimal"` brings up the right keyboard; what is typed is read in the locale (its own
 * group and decimal separators) and emitted as integer minor units, never a float. On blur the amount
 * is clamped to `[min, max]` and re-printed with the locale's grouping and the currency's decimals.
 * The currency mark sits on its locale's side as an adornment the input names in
 * `aria-describedby`, so "100" is announced with what it is 100 of.
 */
export function MoneyInput(props: MoneyInputProps): JSX.Element {
	const {
		value,
		onValueChange,
		currency,
		min = 0,
		max,
		placeholder,
		variant = "outlined",
		size = "md",
		status = "default",
		fluid,
		id,
		name,
		disabled,
		readOnly,
		loading,
		required,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const locale = props.locale ?? displayLocale.value;
	const ctrl = useControllable<number | null>(value, null, onValueChange);
	const inputId = useId(id, "money");
	const currencyId = `${inputId}-currency`;
	const editing = useMemo(() => signal<string | null>(null), []);
	const mark = currencyAdornment(currency, locale);
	const minor = ctrl.signal.value;
	const shown = editing.value ?? (minor === null ? "" : formatMoneyInput(minor, currency, locale));

	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		const text = e.currentTarget.value;
		editing.value = text;
		ctrl.set(parseMoneyInput(text, currency, locale));
	};

	const onBlur = (e: JSX.TargetedFocusEvent<HTMLInputElement>) => {
		const text = editing.peek();
		editing.value = null;
		if (text !== null) {
			const parsed = parseMoneyInput(text, currency, locale);
			ctrl.set(parsed === null ? null : clampMinor(parsed, min, max));
		}
		props.onBlur?.(e);
	};

	const adornment = (
		<span
			id={currencyId}
			class={`ui-input__adornment ui-input__adornment--${mark.position} ui-money-input__currency`}
		>
			<span aria-hidden="true">{mark.symbol}</span>
			<span class="ui-visually-hidden">{currency.toUpperCase()}</span>
		</span>
	);

	return (
		<span
			class={cx(
				"ui-field",
				"ui-input",
				"ui-money-input",
				...fieldModifiers("ui-field", {
					size,
					variant,
					status,
					fluid,
					disabled,
					readOnly,
					loading,
				}),
				className,
			)}
		>
			{mark.position === "start" && adornment}
			<input
				id={inputId}
				name={name}
				type="text"
				inputMode="decimal"
				autoComplete="off"
				class="ui-field__input ui-input__input ui-money-input__input"
				value={shown}
				placeholder={placeholder}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				aria-label={ariaLabel}
				aria-describedby={cx(currencyId, describedBy)}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				aria-busy={loading || undefined}
				onInput={onInput}
				onBlur={onBlur}
			/>
			{mark.position === "end" && adornment}
			<span class="ui-field__mark" aria-hidden="true">
				{loading ? <BusyMark /> : <FieldMark status={status} />}
			</span>
		</span>
	);
}
