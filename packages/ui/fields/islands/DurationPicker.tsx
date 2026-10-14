import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/duration-picker.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import {
	DURATION_CUSTOM,
	DURATION_CUSTOM_KEY,
	DURATION_PRESETS,
	durationLabel,
	durationSegment,
} from "../core/duration.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";
import { SelectButton } from "./SelectButton.tsx";
import { NumberStepper } from "./NumberStepper.tsx";

/** Props for {@link DurationPicker}. */
export interface DurationPickerProps extends BaseFieldProps {
	/** Minutes, or `null` for unset. */
	value?: Bindable<number | null>;
	onValueChange?: ValueChange<number | null>;
	/** Preset minute counts (default 15, 30, 45, 60, 90). */
	presets?: readonly number[];
	class?: string;
}

/**
 * DurationPicker — a {@link SelectButton} of preset durations plus "Custom", which reveals a
 * {@link NumberStepper} (5–600 minutes, in fives). A value that is not a preset opens on Custom, so
 * a stored 75-minute session reads back as what it is.
 */
export function DurationPicker(props: DurationPickerProps): JSX.Element {
	const { value, onValueChange, presets = DURATION_PRESETS, disabled, size = "md" } = props;
	const ctrl = useControllable<number | null>(value, null, onValueChange);
	const rootId = useId(props.id, "duration");
	const minutes = ctrl.signal.value;
	const custom = useMemo(
		() => signal(durationSegment(minutes, presets) === DURATION_CUSTOM_KEY && minutes !== null),
		[],
	);
	const segment = custom.value
		? DURATION_CUSTOM_KEY
		: minutes === null
		? ""
		: durationSegment(minutes, presets);

	const options = [
		...presets.map((m) => ({ label: durationLabel(m), value: String(m) })),
		{ label: "Custom", value: DURATION_CUSTOM_KEY },
	];

	const onSegment = (next: string | string[]) => {
		const key = Array.isArray(next) ? next[0] : next;
		if (key === DURATION_CUSTOM_KEY) {
			custom.value = true;
			if (minutes === null) ctrl.set(DURATION_CUSTOM.min);
			return;
		}
		custom.value = false;
		ctrl.set(Number(key));
	};

	return (
		<div class={cx("ui-duration", props.class)} id={rootId}>
			<div class="ui-duration__row">
				<SelectButton
					class="ui-duration__presets"
					options={options}
					value={segment}
					onValueChange={onSegment}
					size={size}
					disabled={disabled}
					aria-label={props["aria-label"] ?? "Duration"}
					aria-describedby={props["aria-describedby"]}
				/>
				{segment === DURATION_CUSTOM_KEY && (
					<NumberStepper
						class="ui-duration__custom"
						value={minutes}
						onValueChange={(m) => ctrl.set(m)}
						min={DURATION_CUSTOM.min}
						max={DURATION_CUSTOM.max}
						step={DURATION_CUSTOM.step}
						bigStep={DURATION_CUSTOM.bigStep}
						unit="min"
						valueText={(m) => durationLabel(m)}
						size={size}
						disabled={disabled}
						name={props.name}
						aria-label="Custom duration in minutes"
					/>
				)}
			</div>
		</div>
	);
}
