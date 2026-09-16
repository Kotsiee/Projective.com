import type { CSSProperties, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/range-slider.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { clampRange, snapValue } from "../core/range.ts";
import { stepDecimals } from "../core/number-field.ts";
import { Slider, type SliderValue } from "./Slider.tsx";
import { NumberInput } from "./NumberInput.tsx";
import type { BaseFieldProps, Bindable, FieldSize, ValueChange } from "../types/mod.ts";

/** A `[lower, upper]` pair — always ordered, whichever handle or box produced it. */
export type RangeValue = [number, number];

export interface RangeSliderProps extends Omit<BaseFieldProps, "fluid"> {
	/** Bound `[lower, upper]` pair — raw (uncontrolled) or a `Signal` (controlled). */
	value?: Bindable<RangeValue>;
	/** Fired on every change from either handle or either box, always as an ordered pair. */
	onValueChange?: ValueChange<RangeValue>;
	/** Lower bound of the track (default `0`). */
	min?: number;
	/** Upper bound of the track (default `100`). */
	max?: number;
	/** Step for the handles, the arrow keys, the wheel and the boxes (default `1`). */
	step?: number;
	/**
	 * Leading adornment on both boxes — a currency symbol (`$`, `£`) or a unit. Text, not an icon:
	 * notation belongs in the adornment and NOWHERE in the value, so the figure stays editable.
	 */
	symbol?: string;
	/** Trailing unit after each box's value (`days`, `%`). */
	suffix?: string;
	/**
	 * Formats a value for `aria-valuetext` on the handles (`(v) => \`$\${v}\``). Defaults to the
	 * symbol + figure + suffix, which is what the boxes already show.
	 */
	formatValue?: (value: number) => string;
	/**
	 * BCP-47 locale for the boxes' figure formatting. Pass one explicitly wherever the SSR output must
	 * match the client's — a locale-dependent decimal separator is a hydration mismatch waiting to happen.
	 */
	locale?: string;
	/** Hide the two numeric boxes and render the handles alone. */
	hideInputs?: boolean;
	/** Accessible names for the two boxes (default `Minimum` / `Maximum`). */
	inputLabels?: [string, string];
	/** Size ramp shared by the handles and the boxes (default `md`). */
	size?: FieldSize;
	class?: string;
	style?: CSSProperties;
}

/** Order a pair and keep each end on the step grid inside the track. */
function normalise(pair: RangeValue, min: number, max: number, step: number): RangeValue {
	const a = snapValue(clampRange(pair[0], min, max), min, max, step);
	const b = snapValue(clampRange(pair[1], min, max), min, max, step);
	return a <= b ? [a, b] : [b, a];
}

/**
 * RangeSlider — a dual-thumb {@link Slider} whose handles may pass through each other, synced both
 * ways with two numeric boxes carrying a currency or unit adornment. One value, two ways of setting
 * it: drag or nudge a handle (arrows, PageUp/Down, Home/End, the focus-gated wheel) or type into a
 * box (each a `NumberInput`, so it inherits that control's arrow/wheel stepping and Ctrl-fine mode).
 * Whichever way the pair is changed it is re-sorted, so typing a minimum above the current maximum
 * swaps the two rather than refusing the entry. Tab order is lower handle → upper handle → minimum
 * box → maximum box.
 *
 * The DOM-stable handle identity (see {@link SliderProps.allowCross}) is what keeps a drag on the
 * reader's finger through a crossing; the boxes are always the ordered pair, so the "minimum" box is
 * the minimum whichever handle produced it.
 */
export function RangeSlider(props: RangeSliderProps): JSX.Element {
	const {
		value,
		onValueChange,
		min = 0,
		max = 100,
		step = 1,
		symbol,
		suffix,
		formatValue,
		locale,
		hideInputs = false,
		inputLabels = ["Minimum", "Maximum"],
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

	const ctrl = useControllable<RangeValue>(value, [min, max], onValueChange);
	const rootId = useId(id, "range-slider");
	const fractionDigits = stepDecimals(step);

	// The boxes are controlled by their own signals so a half-typed figure is never overwritten by a
	// re-render; the range signal is the source of truth and re-projects into them on every change.
	const loBox = useSignal<number | null>(ctrl.signal.peek()[0]);
	const hiBox = useSignal<number | null>(ctrl.signal.peek()[1]);
	// The track takes its own signal (its value type is the single-or-pair union, which a pair signal
	// cannot stand in for) and is kept in step from the same effect.
	const track = useSignal<SliderValue>(ctrl.signal.peek());
	useSignalEffect(() => {
		const [lo, hi] = ctrl.signal.value;
		loBox.value = lo;
		hiBox.value = hi;
		track.value = [lo, hi];
	});

	const commit = (pair: RangeValue) => {
		if (disabled || readOnly) return;
		const next = normalise(pair, min, max, step);
		const cur = ctrl.signal.peek();
		if (cur[0] === next[0] && cur[1] === next[1]) {
			// The boxes may hold a raw, unsnapped figure the value already equals once normalised;
			// re-project so the box shows the figure the range actually holds.
			loBox.value = next[0];
			hiBox.value = next[1];
			return;
		}
		ctrl.set(next);
	};

	const spoken = formatValue ??
		((v: number) => `${symbol ?? ""}${v}${suffix ? ` ${suffix}` : ""}`);
	const pair = ctrl.signal.value;

	return (
		<div
			id={rootId}
			role="group"
			aria-label={ariaLabel}
			aria-describedby={describedBy}
			class={cx(
				"ui-range-slider",
				`ui-range-slider--size-${size}`,
				disabled && "ui-range-slider--disabled",
				className,
			)}
			style={style && styleVars({}, style)}
		>
			{name !== undefined && <input type="hidden" name={name} value={pair.join(",")} />}
			<Slider
				class="ui-range-slider__track"
				range
				allowCross
				min={min}
				max={max}
				step={step}
				size={size}
				status={status}
				disabled={disabled}
				readOnly={readOnly}
				value={track}
				onValueChange={(v) => {
					if (Array.isArray(v)) commit(v);
				}}
				formatValue={spoken}
				aria-label={ariaLabel}
			/>
			{!hideInputs && (
				<div class="ui-range-slider__inputs">
					<NumberInput
						class="ui-range-slider__input"
						size={size}
						status={status}
						min={min}
						max={max}
						step={step}
						symbol={symbol}
						suffix={suffix}
						locale={locale}
						maxFractionDigits={fractionDigits}
						hideSteppers
						enableIconScrub={false}
						disabled={disabled}
						readOnly={readOnly}
						value={loBox}
						aria-label={inputLabels[0]}
						onValueChange={(n) => {
							if (n === null) return;
							commit([n, ctrl.signal.peek()[1]]);
						}}
					/>
					<span class="ui-range-slider__dash" aria-hidden="true">–</span>
					<NumberInput
						class="ui-range-slider__input"
						size={size}
						status={status}
						min={min}
						max={max}
						step={step}
						symbol={symbol}
						suffix={suffix}
						locale={locale}
						maxFractionDigits={fractionDigits}
						hideSteppers
						enableIconScrub={false}
						disabled={disabled}
						readOnly={readOnly}
						value={hiBox}
						aria-label={inputLabels[1]}
						onValueChange={(n) => {
							if (n === null) return;
							commit([ctrl.signal.peek()[0], n]);
						}}
					/>
				</div>
			)}
		</div>
	);
}

/** Alias for {@link RangeSlider} under the name the dual-thumb pattern is commonly known by. */
export const DualSlider = RangeSlider;
