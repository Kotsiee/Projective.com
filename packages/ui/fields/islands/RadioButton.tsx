import type { ComponentChildren, JSX } from "preact";
import { useMemo } from "preact/hooks";
import "../styles/radio.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";

// #region RadioButton
/** Props for {@link RadioButton}. */
export interface RadioButtonProps extends BaseFieldProps {
	/** This radio's value within its `name` group. */
	value: string;
	/** Bound checked state — raw `boolean` or `Signal<boolean>`. Omit when driven by a {@link RadioGroup}. */
	checked?: Bindable<boolean>;
	/** Fired with the new checked state when this radio is selected. */
	onValueChange?: ValueChange<boolean>;
	/** Visible label rendered after the control. */
	label?: string;
	class?: string;
}

/**
 * RadioButton — a single radio backed by a real hidden `<input type="radio">` (form + native
 * semantics; Space/arrow handled natively within a shared `name`). Use standalone with a bound
 * `checked`, or let a {@link RadioGroup} own selection. Signal-first and token-only.
 */
export function RadioButton(props: RadioButtonProps): JSX.Element {
	const {
		value,
		name,
		checked,
		onValueChange,
		label,
		id,
		disabled,
		required,
		status = "default",
		size = "md",
		class: className,
		...aria
	} = props;

	const ctrl = useControllable<boolean>(checked, false, onValueChange);
	const inputId = useId(id, "radio");

	const onChange = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		ctrl.set(e.currentTarget.checked);
	};

	return (
		<label
			class={cx(
				"ui-radio",
				`ui-radio--size-${size}`,
				status !== "default" && `ui-radio--${status}`,
				disabled && "ui-radio--disabled",
				className,
			)}
		>
			<input
				id={inputId}
				type="radio"
				class="ui-radio__input"
				name={name}
				value={value}
				checked={ctrl.signal.value}
				disabled={disabled}
				required={required}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onChange={onChange}
				{...aria}
			/>
			<span class="ui-radio__box" aria-hidden="true">
				<span class="ui-radio__dot" />
			</span>
			{label !== undefined && <span class="ui-radio__label">{label}</span>}
		</label>
	);
}
// #endregion

// #region RadioGroup
/** Props for {@link RadioGroup}. */
export interface RadioGroupProps extends BaseFieldProps {
	/** Options rendered as radios. Omit to supply {@link RadioButton} children instead. */
	options?: Option[];
	/** Bound selected value — raw `string` or `Signal<string>`. */
	value?: Bindable<string>;
	/** Fired with the newly selected value. */
	onValueChange?: ValueChange<string>;
	/** Layout direction (default `horizontal`). */
	orientation?: "horizontal" | "vertical";
	/** Custom {@link RadioButton} children (used when `options` is omitted). */
	children?: ComponentChildren;
	class?: string;
}

/**
 * RadioGroup — a `role="radiogroup"` that owns single selection across its options. Implements the
 * WAI-ARIA roving-tabindex pattern: only the selected radio (or the first enabled one when nothing is
 * selected) is tabbable; Arrow/Home/End move selection and focus together, skipping disabled options.
 * Pass `options` for the managed path, or `children` to lay out your own {@link RadioButton}s.
 */
export function RadioGroup(props: RadioGroupProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		orientation = "horizontal",
		name,
		id,
		disabled,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		children,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<string>(value, "", onValueChange);
	const groupName = useId(name, "radiogroup");
	const refs = useMemo<Array<HTMLInputElement | null>>(() => [], []);
	const opts = options ?? [];
	const current = ctrl.signal.value;

	const isEnabled = (i: number) => !(disabled || opts[i]?.disabled);
	const firstEnabled = opts.findIndex((_, i) => isEnabled(i));
	const anySelected = opts.some((o) => o.value === current);

	const select = (i: number) => {
		if (!isEnabled(i)) return;
		ctrl.set(opts[i].value);
		refs[i]?.focus();
	};

	const step = (from: number, delta: 1 | -1) => {
		const n = opts.length;
		if (n === 0) return;
		let i = from;
		for (let s = 0; s < n; s++) {
			i = (i + delta + n) % n;
			if (isEnabled(i)) {
				select(i);
				return;
			}
		}
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>, i: number) => {
		switch (e.key) {
			case "ArrowDown":
			case "ArrowRight":
				e.preventDefault();
				step(i, 1);
				break;
			case "ArrowUp":
			case "ArrowLeft":
				e.preventDefault();
				step(i, -1);
				break;
			case "Home":
				e.preventDefault();
				step(-1, 1);
				break;
			case "End":
				e.preventDefault();
				step(0, -1);
				break;
		}
	};

	return (
		<div
			id={id}
			role="radiogroup"
			class={cx(
				"ui-radio-group",
				`ui-radio-group--${orientation}`,
				fluid && "ui-radio-group--fluid",
				className,
			)}
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			aria-invalid={ariaInvalid(status)}
			aria-required={required || undefined}
			aria-disabled={disabled || undefined}
		>
			{opts.map((opt, i) => {
				const selected = current === opt.value;
				const optDisabled = disabled || opt.disabled;
				const tabbable = selected || (!anySelected && i === firstEnabled);
				return (
					<label
						key={opt.value}
						class={cx(
							"ui-radio",
							`ui-radio--size-${size}`,
							status !== "default" && `ui-radio--${status}`,
							optDisabled && "ui-radio--disabled",
						)}
					>
						<input
							ref={(el) => {
								refs[i] = el;
							}}
							type="radio"
							class="ui-radio__input"
							name={groupName}
							value={opt.value}
							checked={selected}
							disabled={optDisabled}
							tabIndex={tabbable ? 0 : -1}
							aria-invalid={ariaInvalid(status)}
							onChange={() => select(i)}
							onKeyDown={(e) => onKeyDown(e, i)}
						/>
						<span class="ui-radio__box" aria-hidden="true">
							<span class="ui-radio__dot" />
						</span>
						<span class="ui-radio__label">{opt.label}</span>
					</label>
				);
			})}
			{children}
		</div>
	);
}
// #endregion
