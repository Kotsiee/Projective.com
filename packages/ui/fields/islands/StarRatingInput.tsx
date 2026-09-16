import type { CSSProperties, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/star-rating.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { clampRange, snapValue } from "../core/range.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

/** How finely a star can be filled — a whole star, or a half. */
export type StarPrecision = 1 | 0.5;

export interface StarRatingInputProps extends Omit<BaseFieldProps, "fluid"> {
	/** Bound rating, `0` meaning none — raw (uncontrolled) or a `Signal` (controlled). */
	value?: Bindable<number>;
	/** Fired when the rating changes. */
	onValueChange?: ValueChange<number>;
	/** Number of stars (default `5`). */
	stars?: number;
	/** Fill granularity (default `0.5`). */
	precision?: StarPrecision;
	/**
	 * Clicking the star that already holds the current value clears it to `0` (default `true`), so
	 * a filter that has been set can be un-set from the same control without a separate clear button.
	 */
	clearable?: boolean;
	/**
	 * Formats the spoken value for `aria-valuetext`. Defaults to `"3.5 of 5 stars"` and `"No rating"`
	 * at zero.
	 */
	formatValue?: (value: number, stars: number) => string;
	class?: string;
	style?: CSSProperties;
}

/**
 * StarRatingInput — a star rating with half-star precision, modelled as ONE `role="slider"` rather
 * than a radiogroup: a value that steps by halves is a number on a scale, not one of five choices,
 * and a single tab stop with Arrow ±precision, PageUp/Down ±1, Home/End is what a slider promises.
 * Hover and pointer position preview the fill at the same precision (the inline-start half of a star
 * is the half-step, in either writing direction); click commits, and clicking the current value
 * clears it when `clearable`.
 *
 * Every star is the registry `star` glyph twice — an outline beneath a clipped filled copy — so the
 * outline and the fill cannot drift geometrically (§B.7). The fill colour is `--ui-star-fill`
 * (default `--warning`, the amber the star metaphor expects); the rest state is the neutral
 * `--outline`. Signal-first via {@link useControllable}, with a local hover-preview signal.
 */
export function StarRatingInput(props: StarRatingInputProps): JSX.Element {
	const {
		value,
		onValueChange,
		stars = 5,
		precision = 0.5,
		clearable = true,
		formatValue,
		size = "md",
		status = "default",
		id,
		name,
		disabled,
		readOnly,
		class: className,
		style,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<number>(value, 0, onValueChange);
	const rootId = useId(id, "star-rating");
	const rootRef = useRef<HTMLDivElement>(null);
	const hover = useSignal<number>(0);
	const locked = disabled || readOnly;

	const current = ctrl.signal.value;
	const preview = hover.value;
	const effective = preview > 0 ? preview : current;
	const spoken = formatValue
		? formatValue(current, stars)
		: current > 0
		? `${current} of ${stars} ${stars === 1 ? "star" : "stars"}`
		: "No rating";

	// #region Writers
	const snap = (v: number): number => snapValue(v, 0, stars, precision);
	const select = (next: number) => {
		if (locked) return;
		ctrl.set(snap(next));
	};
	// #endregion

	// #region Pointer preview + commit
	/** The rating a pointer over star `index1` (1-based) at `clientX` stands for, at the set precision. */
	const ratingAt = (index1: number, el: HTMLElement, clientX: number): number => {
		if (precision === 1) return index1;
		const rect = el.getBoundingClientRect();
		const rtl = getComputedStyle(el).direction === "rtl";
		const fromStart = rtl ? rect.right - clientX : clientX - rect.left;
		const firstHalf = fromStart < rect.width / 2;
		return firstHalf ? index1 - 0.5 : index1;
	};

	const onStarMove = (index1: number) => (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		if (locked) return;
		hover.value = ratingAt(index1, e.currentTarget, e.clientX);
	};

	const onStarClick = (index1: number) => (e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
		if (locked) return;
		const next = ratingAt(index1, e.currentTarget, e.clientX);
		select(clearable && next === ctrl.signal.peek() ? 0 : next);
		rootRef.current?.focus();
	};
	// #endregion

	// #region Keyboard
	const onKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (locked) return;
		let next: number | undefined;
		switch (e.key) {
			case "ArrowRight":
			case "ArrowUp":
				next = current + precision;
				break;
			case "ArrowLeft":
			case "ArrowDown":
				next = current - precision;
				break;
			case "PageUp":
				next = current + 1;
				break;
			case "PageDown":
				next = current - 1;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = stars;
				break;
			case "Backspace":
			case "Delete":
				next = clearable ? 0 : undefined;
				break;
			default:
				return;
		}
		if (next === undefined) return;
		e.preventDefault();
		select(clampRange(next, 0, stars));
	};
	// #endregion

	return (
		<div
			id={rootId}
			ref={rootRef}
			role="slider"
			tabIndex={disabled ? -1 : 0}
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			aria-valuemin={0}
			aria-valuemax={stars}
			aria-valuenow={current}
			aria-valuetext={spoken}
			aria-disabled={disabled || undefined}
			aria-readonly={readOnly || undefined}
			aria-invalid={ariaInvalid(status)}
			class={cx(
				"ui-star-rating",
				`ui-star-rating--size-${size}`,
				readOnly && "ui-star-rating--readonly",
				disabled && "ui-star-rating--disabled",
				status !== "default" && `ui-star-rating--${status}`,
				className,
			)}
			style={style && styleVars({}, style)}
			onKeyDown={onKey}
			onPointerLeave={() => (hover.value = 0)}
		>
			{name !== undefined && <input type="hidden" name={name} value={String(current)} />}
			{Array.from({ length: stars }, (_, i) => {
				const index1 = i + 1;
				const fill = clampRange(effective - i, 0, 1);
				return (
					<span
						key={index1}
						class={cx(
							"ui-star-rating__star ui-hit",
							fill > 0 && "ui-star-rating__star--on",
							preview > 0 && "ui-star-rating__star--preview",
						)}
						style={styleVars({ "--ui-star-fill-w": `${fill * 100}%` })}
						onPointerMove={onStarMove(index1)}
						onPointerEnter={onStarMove(index1)}
						onClick={onStarClick(index1)}
					>
						<Icon name="star" class="ui-star-rating__outline" />
						<span class="ui-star-rating__fill" aria-hidden="true">
							<Icon name="star" filled class="ui-star-rating__glyph" />
						</span>
					</span>
				);
			})}
		</div>
	);
}
