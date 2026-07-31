import type { CSSProperties, JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/slider.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

/** Value of a slider — a single number, or a `[min, max]` pair when `range` is set. */
export type SliderValue = number | [number, number];

export interface SliderProps extends Omit<BaseFieldProps, "fluid"> {
	/** Bound value — raw (uncontrolled) or a `Signal` (controlled). A `[start, end]` pair for `range`. */
	value?: Bindable<SliderValue>;
	/** Fired whenever the value changes (drag, click, or keyboard). */
	onValueChange?: ValueChange<SliderValue>;
	/** Lower bound (default `0`). */
	min?: number;
	/** Upper bound (default `100`). */
	max?: number;
	/** Step granularity for keyboard/drag snapping (default `1`). */
	step?: number;
	/** Two-handle range mode — `value` becomes a `[start, end]` tuple. */
	range?: boolean;
	/** Track axis (default `horizontal`). */
	orientation?: "horizontal" | "vertical";
	/**
	 * Formats the spoken value for `aria-valuetext`. A bare number is rarely the fact a listener
	 * needs — "70" could be percent, pounds or minutes — so give this the unit whenever the slider
	 * carries one (`(v) => \`£\${v}\``, `(v) => \`\${v} minutes\``). Defaults to the raw number.
	 *
	 * In `range` mode it receives each handle's own value; the handle's `aria-label` already says
	 * which end it is.
	 */
	formatValue?: (value: number) => string;
	class?: string;
	style?: CSSProperties;
}

// #region Value helpers
/** Clamp `n` into the inclusive `[lo, hi]` range. */
function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}
// #endregion

/**
 * Slider — a token-driven range input supporting a single handle or a dual-handle range. Each handle
 * is a `role="slider"` with full `aria-value*` state and keyboard operation (Arrow ±step, PageUp/Down
 * ±10·step, Home/End). Pointer drag uses pointer capture; clicking the track jumps the nearest handle.
 * Range handles are constrained so they cannot cross. Signal-first via {@link useControllable}.
 */
export function Slider(props: SliderProps): JSX.Element {
	const {
		value,
		onValueChange,
		min = 0,
		max = 100,
		step = 1,
		range = false,
		orientation = "horizontal",
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

	const fallback: SliderValue = range ? [min, max] : min;
	const ctrl = useControllable<SliderValue>(value, fallback, onValueChange);
	const rootId = useId(id, "slider");
	const trackRef = useRef<HTMLDivElement>(null);
	const dragging = useRef<number | null>(null);
	const vertical = orientation === "vertical";

	// #region Derive handle values
	const raw = ctrl.signal.value;
	const values: number[] = range
		? Array.isArray(raw) ? [raw[0], raw[1]] : [min, max]
		: [typeof raw === "number" ? raw : min];

	const span = max - min || 1;
	const pct = (v: number): number => ((clamp(v, min, max) - min) / span) * 100;
	const snap = (v: number): number => {
		const stepped = Math.round((v - min) / step) * step + min;
		// Trim float noise introduced by the divide/multiply.
		const fixed = Math.round(stepped * 1e6) / 1e6;
		return clamp(fixed, min, max);
	};
	// #endregion

	// #region Writers
	const setHandle = (index: number, next: number) => {
		if (disabled || readOnly) return;
		if (range) {
			const cur = Array.isArray(ctrl.signal.peek())
				? (ctrl.signal.peek() as [number, number])
				: [min, max];
			const pair: [number, number] = [cur[0], cur[1]];
			pair[index] = index === 0 ? clamp(next, min, pair[1]) : clamp(next, pair[0], max);
			ctrl.set(pair);
		} else {
			ctrl.set(clamp(next, min, max));
		}
	};

	const valueFromPointer = (clientX: number, clientY: number): number => {
		const el = trackRef.current;
		if (!el) return min;
		const rect = el.getBoundingClientRect();
		const ratio = vertical
			? (rect.bottom - clientY) / (rect.height || 1)
			: (clientX - rect.left) / (rect.width || 1);
		return snap(min + clamp(ratio, 0, 1) * span);
	};

	const nearestHandle = (target: number): number => {
		if (!range) return 0;
		return Math.abs(values[0] - target) <= Math.abs(values[1] - target) ? 0 : 1;
	};
	// #endregion

	// #region Pointer interaction
	const onHandleDown = (index: number) => (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		e.currentTarget.focus();
		dragging.current = index;
	};

	const onHandleMove = (index: number) => (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragging.current !== index) return;
		setHandle(index, valueFromPointer(e.clientX, e.clientY));
	};

	const onHandleUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragging.current === null) return;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		dragging.current = null;
	};

	const onTrackDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		const target = valueFromPointer(e.clientX, e.clientY);
		const index = nearestHandle(target);
		setHandle(index, target);
	};
	// #endregion

	// #region Keyboard interaction
	const onHandleKey = (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		let next: number | undefined;
		switch (e.key) {
			case "ArrowRight":
			case "ArrowUp":
				next = values[index] + step;
				break;
			case "ArrowLeft":
			case "ArrowDown":
				next = values[index] - step;
				break;
			case "PageUp":
				next = values[index] + step * 10;
				break;
			case "PageDown":
				next = values[index] - step * 10;
				break;
			case "Home":
				next = min;
				break;
			case "End":
				next = max;
				break;
			default:
				return;
		}
		e.preventDefault();
		setHandle(index, snap(next));
	};
	// #endregion

	const fillStart = range ? pct(values[0]) : 0;
	const fillEnd = range ? pct(values[1]) : pct(values[0]);

	return (
		<div
			id={rootId}
			role="group"
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			class={cx(
				"ui-slider",
				`ui-slider--size-${size}`,
				vertical && "ui-slider--vertical",
				range && "ui-slider--range",
				status !== "default" && `ui-slider--${status}`,
				disabled && "ui-slider--disabled",
				readOnly && "ui-slider--readonly",
				className,
			)}
			style={style && styleVars({}, style)}
		>
			{name !== undefined && (
				<input type="hidden" name={name} value={String(range ? values.join(",") : values[0])} />
			)}
			<div ref={trackRef} class="ui-slider__track ui-hit" onPointerDown={onTrackDown}>
				<div
					class="ui-slider__range"
					style={styleVars({
						"--ui-slider-start": `${fillStart}%`,
						"--ui-slider-size": `${Math.abs(fillEnd - fillStart)}%`,
					})}
				/>
				{values.map((v, index) => (
					<div
						key={index}
						class="ui-slider__handle ui-hit"
						role="slider"
						tabIndex={disabled ? -1 : 0}
						aria-valuemin={range && index === 1 ? values[0] : min}
						aria-valuemax={range && index === 0 ? values[1] : max}
						aria-valuenow={v}
						aria-valuetext={formatValue ? formatValue(v) : undefined}
						aria-orientation={orientation}
						aria-disabled={disabled || undefined}
						aria-readonly={readOnly || undefined}
						aria-label={range
							? `${ariaLabel ?? "Value"} ${index === 0 ? "minimum" : "maximum"}`
							: ariaLabel}
						style={styleVars({ "--ui-slider-pos": `${pct(v)}%` })}
						onPointerDown={onHandleDown(index)}
						onPointerMove={onHandleMove(index)}
						onPointerUp={onHandleUp}
						onPointerCancel={onHandleUp}
						onKeyDown={onHandleKey(index)}
					/>
				))}
			</div>
		</div>
	);
}
