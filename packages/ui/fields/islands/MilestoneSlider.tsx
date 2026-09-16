import type { CSSProperties, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/milestone-slider.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { type Milestone, nearestMilestone } from "../core/range.ts";
import { Slider, type SliderValue } from "./Slider.tsx";
import type { BaseFieldProps, Bindable, FieldSize, ValueChange } from "../types/mod.ts";

export type { Milestone };

export interface MilestoneSliderProps extends Omit<BaseFieldProps, "fluid"> {
	/**
	 * The stops, in track order. Their `value`s need not be evenly spaced — the track is divided into
	 * equal STEPS, one per stop, so `Same day · 3 days · 1 week · 1 month` sit an equal distance apart
	 * however unequal the days between them are. That is the whole point of a milestone track over a
	 * linear one.
	 */
	milestones: readonly Milestone[];
	/**
	 * Bound value — the selected stop's `value`, in the caller's unit — raw (uncontrolled) or a
	 * `Signal` (controlled). A value between stops resolves to the nearest one.
	 */
	value?: Bindable<number>;
	/** Fired with the newly selected stop's `value`. */
	onValueChange?: ValueChange<number>;
	/** Draw a tick under each stop (default `true`). */
	showTicks?: boolean;
	/** Print the selected stop's label above the handle (default `true`). */
	showLabel?: boolean;
	/** Print the first and last stops' labels under the track ends (default `true`). */
	showEnds?: boolean;
	/** Size ramp for the underlying track (default `md`). */
	size?: FieldSize;
	class?: string;
	style?: CSSProperties;
}

/**
 * MilestoneSlider — a discrete, non-linear {@link Slider}: the handle snaps between named stops that
 * are equally spaced on the track whatever their values, with tick marks beneath and the selected
 * stop's label riding above the handle. It composes `Slider` (so keyboard, focus-gated wheel, pointer
 * capture and the token contract are inherited rather than restated) and maps the track index onto
 * the stop's value at the boundary. `aria-valuetext` speaks the stop's LABEL — "1 week", never "2".
 */
export function MilestoneSlider(props: MilestoneSliderProps): JSX.Element {
	const {
		milestones,
		value,
		onValueChange,
		showTicks = true,
		showLabel = true,
		showEnds = true,
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

	const last = Math.max(0, milestones.length - 1);
	const ctrl = useControllable<number>(value, milestones[0]?.value ?? 0, onValueChange);
	const rootId = useId(id, "milestone-slider");

	// The track works in stop INDICES; the bound value is the stop's own value. Kept in step both ways.
	const index = useSignal<SliderValue>(nearestMilestone(milestones, ctrl.signal.peek()));
	useSignalEffect(() => {
		index.value = nearestMilestone(milestones, ctrl.signal.value);
	});

	const current = nearestMilestone(milestones, ctrl.signal.value);
	const stop = milestones[current];
	const pct = last === 0 ? 0 : (current / last) * 100;

	const onIndexChange = (v: SliderValue) => {
		if (typeof v !== "number" || disabled || readOnly) return;
		const next = milestones[Math.round(v)];
		if (next && next.value !== ctrl.signal.peek()) ctrl.set(next.value);
	};

	return (
		<div
			id={rootId}
			class={cx(
				"ui-milestone-slider",
				`ui-milestone-slider--size-${size}`,
				disabled && "ui-milestone-slider--disabled",
				className,
			)}
			style={style && styleVars({}, style)}
		>
			{name !== undefined && <input type="hidden" name={name} value={String(stop?.value ?? "")} />}
			{showLabel && stop && (
				<div class="ui-milestone-slider__labels" aria-hidden="true">
					<span
						class="ui-milestone-slider__label"
						data-edge={current === 0 ? "start" : current === last ? "end" : undefined}
						style={styleVars({ "--ui-milestone-pos": `${pct}%` })}
					>
						{stop.label}
					</span>
				</div>
			)}
			<Slider
				class="ui-milestone-slider__track"
				min={0}
				max={last}
				step={1}
				size={size}
				status={status}
				disabled={disabled}
				readOnly={readOnly}
				value={index}
				onValueChange={onIndexChange}
				formatValue={(i) => milestones[Math.round(i)]?.label ?? String(i)}
				aria-label={ariaLabel}
				aria-describedby={describedBy}
			/>
			{showTicks && (
				<div class="ui-milestone-slider__ticks" aria-hidden="true">
					{milestones.map((m, i) => (
						<span
							key={m.value}
							class={cx(
								"ui-milestone-slider__tick",
								i <= current && "ui-milestone-slider__tick--passed",
							)}
							style={styleVars({ "--ui-milestone-pos": `${last === 0 ? 0 : (i / last) * 100}%` })}
						/>
					))}
				</div>
			)}
			{showEnds && milestones.length > 1 && (
				<div class="ui-milestone-slider__ends" aria-hidden="true">
					<span class="ui-milestone-slider__end">{milestones[0].label}</span>
					<span class="ui-milestone-slider__end">{milestones[last].label}</span>
				</div>
			)}
		</div>
	);
}
