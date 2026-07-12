import type { CSSProperties, JSX, VNode } from "preact";
import { useMemo, useState } from "preact/hooks";
import "../styles/field.css";
import "../styles/input-number.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

/** Numeric formatting mode (PrimeNG parity). */
export type NumberMode = "decimal" | "currency";
/** Spinner button arrangement. */
export type ButtonLayout = "stacked" | "horizontal";

export interface InputNumberProps extends BaseFieldProps {
	/** Bound numeric value; `null` represents an empty field. */
	value?: Bindable<number | null>;
	/** Fired when a committed value changes (on blur, step, or clamp). */
	onValueChange?: ValueChange<number | null>;
	/** Placeholder text. */
	placeholder?: string;
	/** `decimal` (default) or `currency` formatting via `Intl.NumberFormat`. */
	mode?: NumberMode;
	/** ISO 4217 currency code (used when `mode` is `currency`). */
	currency?: string;
	/** BCP-47 locale for formatting (defaults to the runtime locale). */
	locale?: string;
	/** Minimum fraction digits in the formatted output. */
	minFractionDigits?: number;
	/** Maximum fraction digits in the formatted output. */
	maxFractionDigits?: number;
	/** Static text rendered before the value (adornment). */
	prefix?: string;
	/** Static text rendered after the value (adornment). */
	suffix?: string;
	/** Lower bound; increments/decrements and commits clamp to it. */
	min?: number;
	/** Upper bound; increments/decrements and commits clamp to it. */
	max?: number;
	/** Increment/decrement granularity (default `1`). */
	step?: number;
	/** Show spinner buttons. */
	showButtons?: boolean;
	/** Spinner arrangement when `showButtons` is set (default `stacked`). */
	buttonLayout?: ButtonLayout;
	/** Surface treatment (§ FieldVariant). */
	variant?: FieldVariant;
	class?: string;
	style?: CSSProperties;
}

const CHEVRON_UP: VNode = (
	<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="none">
		<path
			d="M4 10l4-4 4 4"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
);
const CHEVRON_DOWN: VNode = (
	<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="none">
		<path
			d="M4 6l4 4 4-4"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
);

/**
 * InputNumber — a numeric field with locale-aware `Intl.NumberFormat` display. The value is formatted
 * when blurred and shown as raw, editable text while focused, so typing is never fought by grouping
 * separators. Supports decimal/currency modes, fraction-digit bounds, prefix/suffix adornments,
 * min/max/step clamping, and optional increment/decrement spinner buttons in a stacked or horizontal
 * layout. Keyboard ArrowUp/ArrowDown step the value; the input exposes the `spinbutton` role.
 */
export function InputNumber(props: InputNumberProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder,
		mode = "decimal",
		currency = "USD",
		locale,
		minFractionDigits,
		maxFractionDigits,
		prefix,
		suffix,
		min,
		max,
		step = 1,
		showButtons,
		buttonLayout = "stacked",
		variant = "outlined",
		fluid,
		size = "md",
		status = "default",
		id,
		name,
		disabled,
		readOnly,
		required,
		class: className,
		style,
		...aria
	} = props;

	const ctrl = useControllable<number | null>(value, null, onValueChange);
	const inputId = useId(id, "inputnumber");
	const [focused, setFocused] = useState(false);
	const [draft, setDraft] = useState("");

	// #region Formatting & parsing
	const formatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				style: mode === "currency" ? "currency" : "decimal",
				currency: mode === "currency" ? currency : undefined,
				minimumFractionDigits: minFractionDigits,
				maximumFractionDigits: maxFractionDigits,
			}),
		[locale, mode, currency, minFractionDigits, maxFractionDigits],
	);

	const clamp = (n: number): number => {
		let out = n;
		if (min !== undefined && out < min) out = min;
		if (max !== undefined && out > max) out = max;
		return out;
	};

	const parse = (raw: string): number | null => {
		const cleaned = raw.replace(/[^0-9.\-]/g, "");
		if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
		const n = Number(cleaned);
		return Number.isFinite(n) ? clamp(n) : null;
	};

	const current = ctrl.signal.value;
	const formatted = current === null || current === undefined ? "" : formatter.format(current);
	const displayValue = focused ? draft : formatted;
	// #endregion

	// #region Events
	const onFocus = () => {
		const v = ctrl.get();
		setDraft(v === null || v === undefined ? "" : String(v));
		setFocused(true);
	};

	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		setDraft(e.currentTarget.value);
	};

	const commit = () => {
		const next = parse(draft);
		ctrl.set(next);
		setFocused(false);
	};

	const stepBy = (dir: 1 | -1) => {
		if (disabled || readOnly) return;
		const base = ctrl.get() ?? 0;
		const next = clamp(base + dir * step);
		ctrl.set(next);
		if (focused) setDraft(String(next));
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowUp") {
			e.preventDefault();
			stepBy(1);
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			stepBy(-1);
		}
	};
	// #endregion

	const incDisabled = disabled || readOnly || (max !== undefined && (current ?? 0) >= max);
	const decDisabled = disabled || readOnly || (min !== undefined && (current ?? 0) <= min);

	const incButton = (
		<button
			type="button"
			class="ui-input-number__button ui-input-number__button--inc"
			aria-label="Increment"
			tabIndex={-1}
			disabled={incDisabled}
			onClick={() => stepBy(1)}
		>
			<span class="ui-input-number__button-icon">
				{buttonLayout === "horizontal" ? "+" : CHEVRON_UP}
			</span>
		</button>
	);
	const decButton = (
		<button
			type="button"
			class="ui-input-number__button ui-input-number__button--dec"
			aria-label="Decrement"
			tabIndex={-1}
			disabled={decDisabled}
			onClick={() => stepBy(-1)}
		>
			<span class="ui-input-number__button-icon">
				{buttonLayout === "horizontal" ? "−" : CHEVRON_DOWN}
			</span>
		</button>
	);

	const horizontal = showButtons && buttonLayout === "horizontal";

	return (
		<span
			class={cx(
				"ui-field",
				"ui-input-number",
				horizontal && "ui-input-number--horizontal",
				...fieldModifiers("ui-field", { size, variant, status, fluid, disabled, readOnly }),
				className,
			)}
			style={style && styleVars({}, style)}
		>
			{horizontal && decButton}
			{prefix !== undefined && <span class="ui-input-number__prefix">{prefix}</span>}
			<input
				id={inputId}
				name={name}
				type="text"
				inputMode="decimal"
				role="spinbutton"
				class="ui-field__input ui-input-number__input"
				value={displayValue}
				placeholder={placeholder}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				aria-valuenow={current ?? undefined}
				aria-valuemin={min}
				aria-valuemax={max}
				onFocus={onFocus}
				onInput={onInput}
				onBlur={commit}
				onKeyDown={onKeyDown}
				{...aria}
			/>
			{suffix !== undefined && <span class="ui-input-number__suffix">{suffix}</span>}
			{horizontal && incButton}
			{showButtons && !horizontal && (
				<span class="ui-input-number__buttons ui-input-number__buttons--stacked">
					{incButton}
					{decButton}
				</span>
			)}
		</span>
	);
}
