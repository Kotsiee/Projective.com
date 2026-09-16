import type { CSSProperties, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/slider.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { clampRange, nearestOfPair, resolvePairMove, snapValue } from "../core/range.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

/** Value of a slider — a single number, or a `[min, max]` pair when `range` is set. */
export type SliderValue = number | [number, number];

export interface SliderProps extends Omit<BaseFieldProps, "fluid"> {
	/** Bound value — raw (uncontrolled) or a `Signal` (controlled). A `[start, end]` pair for `range`. */
	value?: Bindable<SliderValue>;
	/** Fired whenever the value changes (drag, click, keyboard or wheel). */
	onValueChange?: ValueChange<SliderValue>;
	/** Lower bound (default `0`). */
	min?: number;
	/** Upper bound (default `100`). */
	max?: number;
	/** Step granularity for keyboard/drag snapping (default `1`). */
	step?: number;
	/** Two-handle range mode — `value` becomes a `[start, end]` tuple. */
	range?: boolean;
	/**
	 * Range mode only: let the two handles pass THROUGH each other (default `false`). The emitted pair
	 * is always `[lower, upper]`; what changes is that dragging the lower handle past the upper one
	 * makes it the upper handle, rather than stopping it at its neighbour. Each handle keeps its DOM
	 * identity across the crossing, so pointer capture and keyboard focus stay on the one the reader is
	 * holding — only its spoken role ("minimum"/"maximum") follows the value.
	 */
	allowCross?: boolean;
	/**
	 * Step the FOCUSED handle on the wheel (default `true`). Focus is the gate deliberately: the event
	 * reaches the track merely because the pointer is over it, and a reader scrolling a long sidebar
	 * past a slider did not ask to change anything.
	 */
	enableWheel?: boolean;
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

/**
 * Slider — a token-driven range input supporting a single handle or a dual-handle range. Each handle
 * is a `role="slider"` with full `aria-value*` state and keyboard operation (Arrow ±step, PageUp/Down
 * ±10·step, Home/End), a focus-gated wheel, and pointer drag through pointer capture; clicking the
 * track jumps the nearest handle. Range handles are constrained so they cannot cross unless
 * {@link SliderProps.allowCross} is set. Signal-first via {@link useControllable}.
 */
export function Slider(props: SliderProps): JSX.Element {
	const {
		value,
		onValueChange,
		min = 0,
		max = 100,
		step = 1,
		range = false,
		allowCross = false,
		enableWheel = true,
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
	/** Whether DOM handle 0 currently holds the UPPER value (only ever flips under `allowCross`). */
	const swapped = useRef(false);
	const vertical = orientation === "vertical";
	const locked = disabled || readOnly;

	// #region Derive handle values
	const raw = ctrl.signal.value;
	const sorted: [number, number] = range
		? Array.isArray(raw) ? [raw[0], raw[1]] : [min, max]
		: [typeof raw === "number" ? raw : min, max];
	/** Values BY DOM HANDLE — the sorted pair re-mapped through the crossing orientation. */
	const values: number[] = range
		? swapped.current ? [sorted[1], sorted[0]] : [sorted[0], sorted[1]]
		: [sorted[0]];

	const span = max - min || 1;
	const pct = (v: number): number => ((clampRange(v, min, max) - min) / span) * 100;
	const snap = (v: number): number => snapValue(v, min, max, step);
	/** Whether DOM handle `index` currently speaks for the lower end of the range. */
	const isLower = (index: number): boolean => (index === 0) !== swapped.current;
	// #endregion

	// #region Writers
	const setHandle = (index: number, next: number) => {
		if (locked) return;
		if (!range) {
			ctrl.set(clampRange(next, min, max));
			return;
		}
		const cur = ctrl.signal.peek();
		const pair: [number, number] = Array.isArray(cur) ? [cur[0], cur[1]] : [min, max];
		const other = isLower(index) ? pair[1] : pair[0];
		const move = resolvePairMove(
			index === 0 ? 0 : 1,
			clampRange(next, min, max),
			other,
			swapped.current,
			allowCross,
		);
		swapped.current = move.swapped;
		ctrl.set(move.pair);
	};

	const valueFromPointer = (clientX: number, clientY: number): number => {
		const el = trackRef.current;
		if (!el) return min;
		const rect = el.getBoundingClientRect();
		const rtl = !vertical && getComputedStyle(el).direction === "rtl";
		const ratio = vertical
			? (rect.bottom - clientY) / (rect.height || 1)
			: rtl
			? (rect.right - clientX) / (rect.width || 1)
			: (clientX - rect.left) / (rect.width || 1);
		return snap(min + clampRange(ratio, 0, 1) * span);
	};

	const nearestHandle = (target: number): number => {
		if (!range) return 0;
		const byDom: [number, number] = [values[0], values[1]];
		return nearestOfPair(byDom, target);
	};
	// #endregion

	// #region Pointer interaction
	const onHandleDown = (index: number) => (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (locked) return;
		e.preventDefault();
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			// The pointer is already gone (a synthetic or cancelled press); the drag simply does not start.
			return;
		}
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
		if (locked) return;
		const target = valueFromPointer(e.clientX, e.clientY);
		const index = nearestHandle(target);
		setHandle(index, target);
	};
	// #endregion

	// #region Keyboard interaction
	const onHandleKey = (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (locked) return;
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

	// #region Wheel
	// Attached by hand so `{ passive: false }` is explicit and `preventDefault` holds — a wheel
	// listener that cannot cancel the event scrolls the page out from under the handle it is nudging.
	const setHandleRef = useRef(setHandle);
	setHandleRef.current = setHandle;
	const valuesRef = useRef(values);
	valuesRef.current = values;
	useEffect(() => {
		const track = trackRef.current;
		if (!track || !enableWheel) return;
		const onWheel = (event: WheelEvent) => {
			const active = track.ownerDocument.activeElement;
			if (!(active instanceof HTMLElement) || !track.contains(active)) return;
			const index = Number(active.dataset.handle);
			if (!Number.isInteger(index)) return;
			const delta = event.deltaY !== 0 ? -event.deltaY : event.deltaX;
			if (delta === 0) return;
			event.preventDefault();
			const cur = valuesRef.current[index] ?? min;
			setHandleRef.current(index, snapValue(cur + (delta > 0 ? step : -step), min, max, step));
		};
		track.addEventListener("wheel", onWheel, { passive: false });
		return () => track.removeEventListener("wheel", onWheel);
	}, [enableWheel, min, max, step]);
	// #endregion

	const fillStart = range ? pct(sorted[0]) : 0;
	const fillEnd = range ? pct(sorted[1]) : pct(values[0]);

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
				<input type="hidden" name={name} value={String(range ? sorted.join(",") : values[0])} />
			)}
			<div ref={trackRef} class="ui-slider__track ui-hit" onPointerDown={onTrackDown}>
				<div
					class="ui-slider__range"
					style={styleVars({
						"--ui-slider-start": `${fillStart}%`,
						"--ui-slider-size": `${Math.abs(fillEnd - fillStart)}%`,
					})}
				/>
				{values.map((v, index) => {
					const lower = isLower(index);
					// Without crossing each handle is bounded by its neighbour; with it either may go
					// anywhere on the track, and saying otherwise would announce a limit that is not there.
					const valueMin = range && !allowCross && !lower ? sorted[0] : min;
					const valueMax = range && !allowCross && lower ? sorted[1] : max;
					return (
						<div
							key={index}
							data-handle={index}
							class="ui-slider__handle ui-hit"
							role="slider"
							tabIndex={disabled ? -1 : 0}
							aria-valuemin={valueMin}
							aria-valuemax={valueMax}
							aria-valuenow={v}
							aria-valuetext={formatValue ? formatValue(v) : undefined}
							aria-orientation={orientation}
							aria-disabled={disabled || undefined}
							aria-readonly={readOnly || undefined}
							aria-label={range
								? `${ariaLabel ?? "Value"} ${lower ? "minimum" : "maximum"}`
								: ariaLabel}
							style={styleVars({ "--ui-slider-pos": `${pct(v)}%` })}
							onPointerDown={onHandleDown(index)}
							onPointerMove={onHandleMove(index)}
							onPointerUp={onHandleUp}
							onPointerCancel={onHandleUp}
							onKeyDown={onHandleKey(index)}
						/>
					);
				})}
			</div>
		</div>
	);
}
