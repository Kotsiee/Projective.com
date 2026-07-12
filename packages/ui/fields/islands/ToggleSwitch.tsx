import type { JSX } from "preact";
import "../styles/switch.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

/** Props for {@link ToggleSwitch}. */
export interface ToggleSwitchProps extends BaseFieldProps {
	/** Bound on/off state — raw `boolean` or `Signal<boolean>`. */
	value?: Bindable<boolean>;
	/** Fired with the new state on every toggle. */
	onValueChange?: ValueChange<boolean>;
	/** Visible label rendered after the switch and associated with it. */
	label?: string;
	class?: string;
}

/**
 * ToggleSwitch — a sliding boolean control exposed as `role="switch"` with `aria-checked`. Space or
 * Enter (native `<button>` activation) toggles it; the knob animates on `--dur-fast` and collapses
 * under reduced motion. When `name` is set a hidden checkbox mirrors the state for form submission.
 * Signal-first and token-only. Also exported as {@link InputSwitch}.
 */
export function ToggleSwitch(props: ToggleSwitchProps): JSX.Element {
	const {
		value,
		onValueChange,
		label,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<boolean>(value, false, onValueChange);
	const rootId = useId(id, "switch");
	const checked = ctrl.signal.value;

	const toggle = () => {
		if (disabled || readOnly) return;
		ctrl.set(!ctrl.get());
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		if (e.key === " " || e.key === "Enter") {
			e.preventDefault();
			toggle();
		}
	};

	return (
		<label
			class={cx(
				"ui-switch",
				`ui-switch--size-${size}`,
				status !== "default" && `ui-switch--${status}`,
				disabled && "ui-switch--disabled",
				className,
			)}
			for={label !== undefined ? rootId : undefined}
		>
			<button
				id={rootId}
				type="button"
				role="switch"
				class="ui-switch__track"
				aria-checked={checked}
				aria-label={ariaLabel}
				aria-describedby={describedBy}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				aria-readonly={readOnly || undefined}
				disabled={disabled}
				onClick={toggle}
				onKeyDown={onKeyDown}
			>
				<span class="ui-switch__knob" aria-hidden="true" />
			</button>
			{name !== undefined && (
				<input
					type="checkbox"
					name={name}
					class="ui-switch__native"
					checked={checked}
					tabIndex={-1}
					aria-hidden="true"
					readOnly
				/>
			)}
			{label !== undefined && <span class="ui-switch__label">{label}</span>}
		</label>
	);
}

/** Alias of {@link ToggleSwitch} (PrimeNG `p-inputSwitch` parity). */
export const InputSwitch = ToggleSwitch;
