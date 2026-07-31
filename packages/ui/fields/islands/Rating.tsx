import type { CSSProperties, JSX, VNode } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/rating.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

export interface RatingProps extends Omit<BaseFieldProps, "fluid"> {
	/** Bound rating (0…`stars`) — raw (uncontrolled) or a `Signal` (controlled). */
	value?: Bindable<number>;
	/** Fired when the rating changes. */
	onValueChange?: ValueChange<number>;
	/** Number of stars (default `5`). */
	stars?: number;
	/** Show a leading clear control that resets the rating to `0`. */
	cancel?: boolean;
	/** Custom filled-star icon. */
	onIcon?: VNode;
	/** Custom empty-star icon. */
	offIcon?: VNode;
	/** Custom cancel-glyph icon. */
	cancelIcon?: VNode;
	class?: string;
	style?: CSSProperties;
}

// #region Default glyphs
const STAR_PATH =
	"M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.9l-5.8 3.05 1.1-6.46-4.69-4.58 6.48-.94z";

/** Default star glyph — `filled` toggles between the solid and hairline outline treatment. */
function star(filled: boolean): VNode {
	return (
		<svg class="ui-rating__icon" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d={STAR_PATH}
				fill={filled ? "currentColor" : "none"}
				stroke="currentColor"
				stroke-width={filled ? 0 : 1.5}
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/** Default cancel glyph — a slashed circle. */
function cancelGlyph(): VNode {
	return (
		<svg class="ui-rating__icon" viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" />
			<path
				d="M6 6l12 12"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
		</svg>
	);
}
// #endregion

/**
 * Rating — a star-based `role="radiogroup"`. Each star is a `role="radio"` carrying `aria-checked`,
 * `aria-posinset`/`aria-setsize`; Arrow keys move (selection follows focus), Home/End jump to the
 * ends, Enter/Space select, and hover previews the fill. An optional cancel control clears to `0`.
 * Signal-first via {@link useControllable}, with a local hover-preview signal.
 */
export function Rating(props: RatingProps): JSX.Element {
	const {
		value,
		onValueChange,
		stars = 5,
		cancel = false,
		readOnly,
		disabled,
		size = "md",
		status = "default",
		id,
		name,
		onIcon,
		offIcon,
		cancelIcon,
		class: className,
		style,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<number>(value, 0, onValueChange);
	const rootId = useId(id, "rating");
	const hover = useMemo(() => signal<number>(0), []);
	const starRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const current = ctrl.signal.value;
	const preview = hover.value;
	const effective = preview > 0 ? preview : current;
	const tabbable = current > 0 ? current : 1;
	const locked = disabled || readOnly;

	// #region Interaction
	const select = (next: number) => {
		if (locked) return;
		ctrl.set(next);
	};

	const focusStar = (index1: number) => {
		if (index1 >= 1 && index1 <= stars) starRefs.current[index1 - 1]?.focus();
	};

	const onStarKey = (index1: number) => (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		if (locked) return;
		let next = current || index1;
		switch (e.key) {
			case "ArrowRight":
			case "ArrowUp":
				next = Math.min(stars, index1 + 1);
				break;
			case "ArrowLeft":
			case "ArrowDown":
				next = Math.max(cancel ? 0 : 1, index1 - 1);
				break;
			case "Home":
				next = cancel ? 0 : 1;
				break;
			case "End":
				next = stars;
				break;
			case "Enter":
			case " ":
				next = index1;
				break;
			default:
				return;
		}
		e.preventDefault();
		select(next);
		focusStar(next);
	};
	// #endregion

	return (
		<div
			id={rootId}
			role="radiogroup"
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			aria-disabled={disabled || undefined}
			aria-readonly={readOnly || undefined}
			aria-invalid={ariaInvalid(status)}
			class={cx(
				"ui-rating",
				`ui-rating--size-${size}`,
				readOnly && "ui-rating--readonly",
				disabled && "ui-rating--disabled",
				status !== "default" && `ui-rating--${status}`,
				className,
			)}
			style={style && styleVars({}, style)}
			onMouseLeave={() => (hover.value = 0)}
		>
			{name !== undefined && <input type="hidden" name={name} value={String(current)} />}
			{cancel && !readOnly && !disabled && (
				<button
					type="button"
					class="ui-rating__cancel"
					aria-label="Clear rating"
					onClick={() => select(0)}
					onMouseEnter={() => (hover.value = 0)}
				>
					{cancelIcon ?? cancelGlyph()}
				</button>
			)}
			{Array.from({ length: stars }, (_, i) => {
				const index1 = i + 1;
				const filled = index1 <= effective;
				return (
					<button
						key={index1}
						ref={(el) => {
							starRefs.current[i] = el;
						}}
						type="button"
						class={cx("ui-rating__star ui-hit", filled && "ui-rating__star--on")}
						role="radio"
						aria-checked={index1 === current}
						aria-posinset={index1}
						aria-setsize={stars}
						/* "3 of 5 stars", not "3 stars" — the scale is the half of the fact that a bare
						   position leaves out, and a listener cannot infer it from the group. */
						aria-label={`${index1} of ${stars} ${stars === 1 ? "star" : "stars"}`}
						tabIndex={disabled ? -1 : index1 === tabbable ? 0 : -1}
						disabled={disabled}
						onClick={() => select(index1)}
						onKeyDown={onStarKey(index1)}
						onMouseEnter={() => !locked && (hover.value = index1)}
					>
						{filled ? (onIcon ?? star(true)) : (offIcon ?? star(false))}
					</button>
				);
			})}
		</div>
	);
}
