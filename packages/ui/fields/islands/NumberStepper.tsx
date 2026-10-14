import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/field.css";
import "../styles/number-stepper.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import { parseNumericInput } from "../core/number-field.ts";
import { settleStepper, stepperKey } from "../core/number-stepper.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

/** Props for {@link NumberStepper}. */
export interface NumberStepperProps extends BaseFieldProps {
	value?: Bindable<number | null>;
	onValueChange?: ValueChange<number | null>;
	min?: number;
	max?: number;
	/** ↑/↓ and the buttons step by this (default 1). */
	step?: number;
	/** PageUp/PageDown step by this (default `step × 10`). */
	bigStep?: number;
	/** The spoken value (`aria-valuetext`), e.g. "45 minutes". */
	valueText?: (value: number) => string;
	/** A unit shown after the figure ("min"). */
	unit?: string;
	class?: string;
}

/**
 * NumberStepper — − / + buttons around a typed figure that is a `role="spinbutton"`.
 *
 * ↑/↓ step by `step`, PageUp/PageDown by `bigStep`, Home/End go to the bounds (plan §4.5); typing
 * commits on blur or Enter, snapped to the step grid and clamped. The buttons are pointer affordances
 * outside the tab order, because the spinbutton already owns every key they would.
 */
export function NumberStepper(props: NumberStepperProps): JSX.Element {
	const {
		value,
		onValueChange,
		min,
		max,
		step = 1,
		bigStep,
		valueText,
		unit,
		size = "md",
		status = "default",
		fluid,
		id,
		name,
		disabled,
		readOnly,
		required,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<number | null>(value, null, onValueChange);
	const inputId = useId(id, "stepper");
	const editing = useMemo(() => signal<string | null>(null), []);
	const bounds = { min, max, step, bigStep };
	const current = ctrl.signal.value;
	const shown = editing.value ?? (current === null ? "" : String(current));
	const locked = disabled || readOnly;

	const set = (next: number | null) => {
		editing.value = null;
		if (next !== ctrl.get()) ctrl.set(next);
	};

	const commitText = () => {
		const text = editing.peek();
		if (text === null) return;
		const parsed = parseNumericInput(text);
		set(parsed === null ? null : settleStepper(parsed, bounds));
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (locked) return;
		if (e.key === "Enter") {
			commitText();
			return;
		}
		const next = stepperKey(current, e.key, bounds);
		if (next === undefined) return;
		e.preventDefault();
		set(next);
	};

	const bump = (dir: 1 | -1) => {
		if (locked) return;
		const next = stepperKey(current, dir === 1 ? "ArrowUp" : "ArrowDown", bounds);
		if (next !== undefined) set(next);
	};

	return (
		<span
			class={cx(
				"ui-field",
				"ui-numstep",
				...fieldModifiers("ui-field", { size, status, fluid, disabled, readOnly }),
				className,
			)}
		>
			<button
				type="button"
				class="ui-numstep__btn"
				tabIndex={-1}
				aria-label="Decrease"
				aria-controls={inputId}
				disabled={locked || (min !== undefined && current !== null && current <= min)}
				onClick={() => bump(-1)}
			>
				<Icon name="minus" size="sm" />
			</button>
			<input
				id={inputId}
				name={name}
				type="text"
				inputMode="numeric"
				autoComplete="off"
				role="spinbutton"
				class="ui-field__input ui-numstep__input"
				value={shown}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				aria-label={ariaLabel}
				aria-describedby={describedBy}
				aria-valuenow={current ?? undefined}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuetext={current !== null && valueText ? valueText(current) : undefined}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onInput={(e) => (editing.value = e.currentTarget.value)}
				onKeyDown={onKeyDown}
				onBlur={commitText}
			/>
			{unit && <span class="ui-numstep__unit" aria-hidden="true">{unit}</span>}
			<button
				type="button"
				class="ui-numstep__btn"
				tabIndex={-1}
				aria-label="Increase"
				aria-controls={inputId}
				disabled={locked || (max !== undefined && current !== null && current >= max)}
				onClick={() => bump(1)}
			>
				<Icon name="plus" size="sm" />
			</button>
		</span>
	);
}
