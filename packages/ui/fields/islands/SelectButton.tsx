import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/select-button.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";

/** Props for {@link SelectButton}. */
export interface SelectButtonProps extends BaseFieldProps {
	/** Segments to render. */
	options: Option[];
	/**
	 * Bound selection — a `string` (single) or `string[]` (multiple), raw or as a `Signal`. Match the
	 * shape to `multiple`.
	 */
	value?: Bindable<string | string[]>;
	/** Fired with the new selection. */
	onValueChange?: ValueChange<string | string[]>;
	/** Allow multiple selected segments (`role="group"` of toggles instead of a radiogroup). */
	multiple?: boolean;
	class?: string;
}

/**
 * SelectButton — a segmented switch across a small option set. In single mode it is a
 * `role="radiogroup"` of `role="radio"` segments (Arrow/Home/End move selection, roving tabindex); in
 * `multiple` mode it is a `role="group"` of `aria-pressed` toggle buttons (Arrow moves focus,
 * Space/Enter toggles). Signal-first.
 *
 * Visually it is an inset track carrying a raised thumb: the group owns the recessed ground and the
 * shared outline, and the selected segment rises out of it on its own surface, brand-tinted hairline
 * and shadow. `select-button.css` carries the measurements behind that choice.
 *
 * `readOnly` and `loading` are honoured rather than accepted and dropped — the §A.7.3 state matrix
 * asks every control for the same set, and a read-only segmented control that silently keeps
 * changing its own value is the worse half of that gap.
 */
export function SelectButton(props: SelectButtonProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		multiple,
		id,
		disabled,
		readOnly,
		loading,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<string | string[]>(value, multiple ? [] : "", onValueChange);
	const rootId = useId(id, "select-button");
	const refs = useMemo<Array<HTMLButtonElement | null>>(() => [], []);
	const focusIndex = useMemo(() => signal<number>(-1), []);

	const current = ctrl.signal.value;
	const selectedValues = multiple ? (Array.isArray(current) ? current : []) : [];
	const isSelected = (v: string) => (multiple ? selectedValues.includes(v) : current === v);

	const isEnabled = (i: number) => !(disabled || options[i]?.disabled);
	const firstEnabled = options.findIndex((_, i) => isEnabled(i));
	const selectedIndex = options.findIndex((o) => isSelected(o.value));
	const defaultTabbable = !multiple && selectedIndex >= 0 ? selectedIndex : firstEnabled;
	const tabbableIndex = focusIndex.value >= 0 ? focusIndex.value : defaultTabbable;

	const toggle = (i: number) => {
		if (!isEnabled(i) || readOnly) return;
		const v = options[i].value;
		if (multiple) {
			const next = selectedValues.includes(v)
				? selectedValues.filter((x) => x !== v)
				: [...selectedValues, v];
			ctrl.set(next);
		} else {
			ctrl.set(v);
		}
	};

	const focusTo = (i: number) => {
		focusIndex.value = i;
		refs[i]?.focus();
	};

	const step = (from: number, delta: 1 | -1) => {
		const n = options.length;
		if (n === 0) return;
		let i = from;
		for (let s = 0; s < n; s++) {
			i = (i + delta + n) % n;
			if (isEnabled(i)) {
				focusTo(i);
				if (!multiple) toggle(i);
				return;
			}
		}
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, i: number) => {
		switch (e.key) {
			case "ArrowRight":
			case "ArrowDown":
				e.preventDefault();
				step(i, 1);
				break;
			case "ArrowLeft":
			case "ArrowUp":
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
			case " ":
			case "Enter":
				if (multiple) {
					e.preventDefault();
					toggle(i);
				}
				break;
		}
	};

	return (
		<div
			id={rootId}
			role={multiple ? "group" : "radiogroup"}
			class={cx(
				"ui-select-button",
				`ui-select-button--size-${size}`,
				status !== "default" && `ui-select-button--${status}`,
				fluid && "ui-select-button--fluid",
				disabled && "ui-select-button--disabled",
				readOnly && "ui-select-button--readonly",
				loading && "ui-select-button--loading",
				className,
			)}
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			aria-invalid={ariaInvalid(status)}
			aria-required={required || undefined}
			aria-disabled={disabled || undefined}
			aria-readonly={readOnly || undefined}
			aria-busy={loading || undefined}
		>
			{options.map((opt, i) => {
				const selected = isSelected(opt.value);
				const optDisabled = disabled || opt.disabled;
				return (
					<button
						key={opt.value}
						ref={(el) => {
							refs[i] = el;
						}}
						type="button"
						role={multiple ? undefined : "radio"}
						class="ui-select-button__option"
						aria-pressed={multiple ? selected : undefined}
						aria-checked={multiple ? undefined : selected}
						tabIndex={i === tabbableIndex ? 0 : -1}
						disabled={optDisabled}
						onClick={() => {
							focusIndex.value = i;
							toggle(i);
						}}
						onKeyDown={(e) => onKeyDown(e, i)}
					>
						{opt.icon && <span class="ui-select-button__icon" aria-hidden="true">{opt.icon}</span>}
						<span class="ui-select-button__label">{opt.label}</span>
					</button>
				);
			})}
		</div>
	);
}
