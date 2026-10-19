import type { JSX } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/select-button.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";

/** Props for {@link SelectButton}. */
export interface SelectButtonProps extends BaseFieldProps {
	/**
	 * Segments to render. An option's `description` draws as a second, meta-register line, and any
	 * option carrying one switches the group to the described layout (a wrapping grid of two-line
	 * segments instead of a one-line pill).
	 */
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
	/**
	 * Single mode only: each segment's address. The segments render as links, so the choice works
	 * without JavaScript (each link loads its own page) and can be opened in a new tab. Once hydrated
	 * the group becomes the ordinary radiogroup — a press selects in place and the link's navigation is
	 * not followed — so the host keeps the address bar in step (`history.replaceState`).
	 */
	hrefFor?: (value: string) => string;
	class?: string;
}

/**
 * SelectButton — a segmented switch across a small option set. In single mode it is a
 * `role="radiogroup"` of `role="radio"` segments (Arrow/Home/End move selection, roving tabindex); in
 * `multiple` mode it is a `role="group"` of `aria-pressed` toggle buttons (Arrow moves focus,
 * Space/Enter toggles). With `hrefFor` the segments are links: before hydration a plain group of
 * links (`aria-current` on the selected one, every link reachable by Tab), after it the same
 * radiogroup with each radio keeping its `href`. Segments share one outline with single interior
 * hairline seams. Signal-first.
 */
export function SelectButton(props: SelectButtonProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		multiple,
		hrefFor,
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

	const ctrl = useControllable<string | string[]>(value, multiple ? [] : "", onValueChange);
	const rootId = useId(id, "select-button");
	const refs = useMemo<Array<HTMLElement | null>>(() => [], []);
	const focusIndex = useMemo(() => signal<number>(-1), []);
	const linked = !multiple && typeof hrefFor === "function";
	// Links stay links until the island runs: a server render (or a page whose JS never loads) keeps
	// every segment a reachable link, and the radiogroup's roving tabindex only applies once a script
	// is there to move it.
	const hydrated = useMemo(() => signal(false), []);
	useEffect(() => {
		hydrated.value = true;
	}, []);
	const asLinks = linked && !hydrated.value;
	const described = options.some((o) => !!o.description);

	const current = ctrl.signal.value;
	const selectedValues = multiple ? (Array.isArray(current) ? current : []) : [];
	const isSelected = (v: string) => (multiple ? selectedValues.includes(v) : current === v);

	const isEnabled = (i: number) => !(disabled || options[i]?.disabled);
	const firstEnabled = options.findIndex((_, i) => isEnabled(i));
	const selectedIndex = options.findIndex((o) => isSelected(o.value));
	const defaultTabbable = !multiple && selectedIndex >= 0 ? selectedIndex : firstEnabled;
	const tabbableIndex = focusIndex.value >= 0 ? focusIndex.value : defaultTabbable;

	const toggle = (i: number) => {
		if (!isEnabled(i)) return;
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

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
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
				// A toggle and a linked radio both act on Space; a linked radio's Enter would otherwise
				// follow its href.
				if (multiple || linked) {
					e.preventDefault();
					toggle(i);
				}
				break;
		}
	};

	const segmentBody = (opt: Option) => (
		<>
			{opt.icon && <span class="ui-select-button__icon" aria-hidden="true">{opt.icon}</span>}
			{opt.description
				? (
					<span class="ui-select-button__text">
						<span class="ui-select-button__label">{opt.label}</span>
						<span class="ui-select-button__description">{opt.description}</span>
					</span>
				)
				: <span class="ui-select-button__label">{opt.label}</span>}
		</>
	);

	return (
		<div
			id={rootId}
			role={multiple || asLinks ? "group" : "radiogroup"}
			class={cx(
				"ui-select-button",
				`ui-select-button--size-${size}`,
				status !== "default" && `ui-select-button--${status}`,
				fluid && "ui-select-button--fluid",
				described && "ui-select-button--described",
				disabled && "ui-select-button--disabled",
				className,
			)}
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			aria-invalid={asLinks ? undefined : ariaInvalid(status)}
			aria-required={asLinks ? undefined : required || undefined}
			aria-disabled={disabled || undefined}
		>
			{options.map((opt, i) => {
				const selected = isSelected(opt.value);
				const optDisabled = disabled || opt.disabled;
				if (linked && hrefFor) {
					const href = hrefFor(opt.value);
					return (
						<a
							key={opt.value}
							ref={(el) => {
								refs[i] = el;
							}}
							href={optDisabled ? undefined : href}
							role={asLinks ? undefined : "radio"}
							class="ui-select-button__option"
							aria-current={asLinks && selected ? "true" : undefined}
							aria-checked={asLinks ? undefined : selected}
							aria-disabled={optDisabled || undefined}
							tabIndex={asLinks ? undefined : i === tabbableIndex ? 0 : -1}
							onClick={(e) => {
								if (asLinks) return;
								if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
								e.preventDefault();
								focusIndex.value = i;
								toggle(i);
							}}
							onKeyDown={asLinks ? undefined : (e) => onKeyDown(e, i)}
						>
							{segmentBody(opt)}
						</a>
					);
				}
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
						{segmentBody(opt)}
					</button>
				);
			})}
		</div>
	);
}
