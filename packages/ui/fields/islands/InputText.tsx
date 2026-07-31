import type { CSSProperties, JSX, VNode } from "preact";
import "../styles/field.css";
import "../styles/input.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import { BusyMark, FieldMark } from "../components/field-marks.tsx";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

export interface InputTextProps extends BaseFieldProps {
	/** Bound text value — raw string (uncontrolled) or `Signal<string>` (controlled). */
	value?: Bindable<string>;
	/** Fired on every keystroke with the new value. */
	onValueChange?: ValueChange<string>;
	/** Placeholder text. */
	placeholder?: string;
	/** Native input type (text, email, url, tel, search, …). */
	type?: string;
	/** Surface treatment (§ FieldVariant). `transparent` suits in-group / inline use. */
	variant?: FieldVariant;
	/** Render as a full-width block element (PrimeNG `block`). Implies `fluid`. */
	block?: boolean;
	/** Leading adornment (icon/text) rendered inside the control before the input. */
	start?: VNode | string;
	/** Trailing adornment rendered inside the control after the input. */
	end?: VNode | string;
	/** Max character length. */
	maxLength?: number;
	/** Autocomplete hint for the browser. */
	autoComplete?: string;
	/**
	 * Blur handler. Declared explicitly rather than left to the rest spread because "has this field
	 * been touched yet" is the standard way a form avoids showing a required error before the user
	 * has had a turn, and a prop that only works by accident is not a contract.
	 */
	onBlur?: JSX.FocusEventHandler<HTMLInputElement>;
	/** Focus handler (see {@link InputTextProps.onBlur}). */
	onFocus?: JSX.FocusEventHandler<HTMLInputElement>;
	class?: string;
	style?: CSSProperties;
}

/**
 * InputText — the base single-line text control. Signal-first: pass a `Signal<string>` for
 * controlled use or a raw string for uncontrolled. Composes the shared `.ui-field` geometry and
 * supports outlined/filled/transparent variants, `fluid`/`block` sizing, validation status, and
 * leading/trailing adornment slots (also used by IconField / InputGroup).
 */
export function InputText(props: InputTextProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder,
		type = "text",
		variant = "outlined",
		block,
		fluid,
		size = "md",
		status = "default",
		start,
		end,
		id,
		name,
		disabled,
		readOnly,
		loading,
		required,
		maxLength,
		autoComplete,
		class: className,
		style,
		...aria
	} = props;

	const ctrl = useControllable<string>(value, "", onValueChange);
	const inputId = useId(id, "input");
	const isFluid = fluid || block;

	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		ctrl.set(e.currentTarget.value);
	};

	return (
		<span
			class={cx(
				"ui-field",
				"ui-input",
				...fieldModifiers("ui-field", {
					size,
					variant,
					status,
					fluid: isFluid,
					disabled,
					readOnly,
					loading,
				}),
				block && "ui-input--block",
				className,
			)}
			style={style && styleVars({}, style)}
		>
			{start !== undefined && (
				<span class="ui-input__adornment ui-input__adornment--start">{start}</span>
			)}
			<input
				id={inputId}
				name={name}
				type={type}
				class="ui-field__input ui-input__input"
				value={ctrl.signal.value}
				placeholder={placeholder}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				maxLength={maxLength}
				autoComplete={autoComplete}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				aria-busy={loading || undefined}
				onInput={onInput}
				{...aria}
			/>
			{end !== undefined && <span class="ui-input__adornment ui-input__adornment--end">{end}</span>}
			{
				/*
				 * The status channel (§A.5). A validation state must never ride on hue alone, and the
				 * coloured border was the only signal the taxonomy had. The slot collapses to zero width at
				 * rest, so a neutral field is byte-identical to before; `aria-hidden` because the state is
				 * already carried programmatically by `aria-invalid` and the described error text.
				 */
			}
			<span class="ui-field__mark" aria-hidden="true">
				{loading ? <BusyMark /> : <FieldMark status={status} />}
			</span>
		</span>
	);
}
