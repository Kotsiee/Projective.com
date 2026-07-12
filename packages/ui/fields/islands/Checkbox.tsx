import type { JSX } from "preact";
import "../styles/checkbox.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

// #region Checkbox
/** Props for {@link Checkbox}. */
export interface CheckboxProps extends BaseFieldProps {
	/** Bound checked state — raw `boolean` (uncontrolled) or `Signal<boolean>` (controlled). */
	value?: Bindable<boolean>;
	/** Fired with the new checked state on every toggle. */
	onValueChange?: ValueChange<boolean>;
	/**
	 * Third "mixed" state. Drives `aria-checked="mixed"` and a dash glyph; visually overrides the
	 * checked fill until the user toggles. The parent owns this flag (as PrimeNG does).
	 */
	indeterminate?: boolean;
	/** Visible label rendered after the box and associated with the input. */
	label?: string;
	class?: string;
}

/** Fresh check-mark VNode (never reuse a single VNode instance across trees). */
function CheckIcon(): JSX.Element {
	return (
		<svg class="ui-checkbox__check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M5 12.5l4.5 4.5L19 7"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/**
 * Checkbox — a single boolean control with an optional third (indeterminate) state. Backed by a real
 * hidden `<input type="checkbox">` for form submission and native keyboard (Space toggles); the
 * styled box mirrors `:checked`/`:indeterminate` in pure CSS. Signal-first: pass a `Signal<boolean>`
 * for controlled use or a raw boolean for uncontrolled.
 */
export function Checkbox(props: CheckboxProps): JSX.Element {
	const {
		value,
		onValueChange,
		indeterminate,
		label,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		class: className,
		...aria
	} = props;

	const ctrl = useControllable<boolean>(value, false, onValueChange);
	const inputId = useId(id, "checkbox");

	const onChange = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		if (readOnly) {
			e.currentTarget.checked = ctrl.get();
			return;
		}
		ctrl.set(e.currentTarget.checked);
	};

	return (
		<label
			class={cx(
				"ui-checkbox",
				`ui-checkbox--size-${size}`,
				status !== "default" && `ui-checkbox--${status}`,
				disabled && "ui-checkbox--disabled",
				className,
			)}
		>
			<input
				id={inputId}
				name={name}
				type="checkbox"
				class="ui-checkbox__input"
				checked={ctrl.signal.value}
				indeterminate={indeterminate}
				disabled={disabled}
				required={required}
				aria-checked={indeterminate ? "mixed" : undefined}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onChange={onChange}
				{...aria}
			/>
			<span class="ui-checkbox__box" aria-hidden="true">
				<CheckIcon />
				<span class="ui-checkbox__dash" />
			</span>
			{label !== undefined && (
				<span class="ui-checkbox__label">
					{label}
					{required && <span class="ui-checkbox__required" aria-hidden="true">*</span>}
				</span>
			)}
		</label>
	);
}
// #endregion

// #region TriStateCheckbox
type TriState = boolean | null;

/** Props for {@link TriStateCheckbox}. */
export interface TriStateCheckboxProps extends BaseFieldProps {
	/** Bound tri-state — `null` (empty), `true` (check) or `false` (cross). */
	value?: Bindable<TriState>;
	/** Fired with the next state on every cycle. */
	onValueChange?: ValueChange<TriState>;
	/** Visible label rendered after the box. */
	label?: string;
	class?: string;
}

/** Fresh cross VNode for the `false` tri-state. */
function CrossIcon(): JSX.Element {
	return (
		<svg class="ui-checkbox__cross" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M6 6l12 12M18 6L6 18"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/** Cycle order: `null` → `true` → `false` → `null`. */
function nextTriState(current: TriState): TriState {
	if (current === null) return true;
	if (current === true) return false;
	return null;
}

/** Human-readable state name for the `aria-label`. */
function triStateLabel(state: TriState): string {
	if (state === true) return "checked";
	if (state === false) return "unchecked";
	return "not set";
}

/**
 * TriStateCheckbox — a three-state checkbox (empty / true / false) exposed as `role="checkbox"` with
 * `aria-checked` of `mixed`/`true`/`false`. Clicking or pressing Space/Enter cycles
 * `null → true → false → null`, showing an empty box, a check, then a cross. The current state is
 * announced via a per-state `aria-label`.
 */
export function TriStateCheckbox(props: TriStateCheckboxProps): JSX.Element {
	const {
		value,
		onValueChange,
		label,
		id,
		disabled,
		readOnly,
		status = "default",
		size = "md",
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<TriState>(value, null, onValueChange);
	const rootId = useId(id, "tristate");
	const state = ctrl.signal.value;

	const cycle = () => {
		if (disabled || readOnly) return;
		ctrl.set(nextTriState(ctrl.get()));
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		if (e.key === " " || e.key === "Enter") {
			e.preventDefault();
			cycle();
		}
	};

	const ariaChecked: JSX.AriaAttributes["aria-checked"] = state === null
		? "mixed"
		: state
		? "true"
		: "false";
	const stateText = triStateLabel(state);

	return (
		<label
			class={cx(
				"ui-checkbox",
				`ui-checkbox--size-${size}`,
				status !== "default" && `ui-checkbox--${status}`,
				disabled && "ui-checkbox--disabled",
				className,
			)}
			for={label !== undefined ? rootId : undefined}
		>
			<button
				id={rootId}
				type="button"
				role="checkbox"
				class="ui-tristate-checkbox"
				data-state={state === null ? "null" : String(state)}
				aria-checked={ariaChecked}
				aria-label={ariaLabel ?? (label ? `${label}, ${stateText}` : stateText)}
				aria-invalid={ariaInvalid(status)}
				aria-describedby={describedBy}
				disabled={disabled}
				onClick={cycle}
				onKeyDown={onKeyDown}
			>
				<span class="ui-checkbox__box" aria-hidden="true">
					<CheckIcon />
					<CrossIcon />
				</span>
			</button>
			{label !== undefined && <span class="ui-checkbox__label">{label}</span>}
		</label>
	);
}
// #endregion
