import type { JSX, VNode } from "preact";
import "../styles/toggle-button.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

/** Props for {@link ToggleButton}. */
export interface ToggleButtonProps extends BaseFieldProps {
	/** Bound on/off state — raw `boolean` or `Signal<boolean>`. */
	value?: Bindable<boolean>;
	/** Fired with the new state on every toggle. */
	onValueChange?: ValueChange<boolean>;
	/** Label shown while on (default `"Yes"`). */
	onLabel?: string;
	/** Label shown while off (default `"No"`). */
	offLabel?: string;
	/** Icon shown while on. */
	onIcon?: VNode;
	/** Icon shown while off. */
	offIcon?: VNode;
	class?: string;
}

/**
 * ToggleButton — a single button that flips between two states, exposing `aria-pressed`. Shows the
 * on/off label and icon for the current state; the pressed state fills with the accent (button visual
 * language on the token contract). Native `<button>` keyboard (Space/Enter) toggles it. Signal-first.
 */
export function ToggleButton(props: ToggleButtonProps): JSX.Element {
	const {
		value,
		onValueChange,
		onLabel = "Yes",
		offLabel = "No",
		onIcon,
		offIcon,
		id,
		disabled,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<boolean>(value, false, onValueChange);
	const rootId = useId(id, "toggle-button");
	const on = ctrl.signal.value;

	const toggle = () => {
		if (disabled) return;
		ctrl.set(!ctrl.get());
	};

	const icon = on ? onIcon : offIcon;
	const label = on ? onLabel : offLabel;

	return (
		<button
			id={rootId}
			type="button"
			class={cx(
				"ui-toggle-button",
				`ui-toggle-button--size-${size}`,
				status !== "default" && `ui-toggle-button--${status}`,
				fluid && "ui-toggle-button--fluid",
				className,
			)}
			aria-pressed={on}
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			aria-invalid={ariaInvalid(status)}
			aria-required={required || undefined}
			disabled={disabled}
			onClick={toggle}
		>
			{icon && <span class="ui-toggle-button__icon">{icon}</span>}
			<span class="ui-toggle-button__label">{label}</span>
		</button>
	);
}
