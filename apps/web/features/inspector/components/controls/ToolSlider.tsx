import type { Signal } from "@preact/signals";
import type { JSX } from "preact";
import { Slider } from "@projective/ui/fields";
import { ToolReadout } from "./ToolReadout.tsx";

/** Props for {@link ToolSlider}. */
export interface ToolSliderProps {
	label: string;
	value: Signal<number>;
	min: number;
	max: number;
	step?: number;
	/** Formats the live readout and the spoken value, e.g. `(v) => \`${v}%\``. */
	formatValue?: (value: number) => string;
	disabled?: boolean;
}

/** A labelled slider with its live value beside the label. */
export function ToolSlider(props: ToolSliderProps): JSX.Element {
	const { label, value, min, max, step = 1, formatValue, disabled } = props;
	const format = formatValue ?? String;
	return (
		<div class="ins-tool-slider">
			<div class="ins-tool-slider__head">
				<span class="ins-tool-slider__label" aria-hidden="true">{label}</span>
				<ToolReadout value={format(value.value)} />
			</div>
			<Slider
				class="ins-tool-slider__track"
				size="sm"
				min={min}
				max={max}
				step={step}
				value={value}
				formatValue={format}
				disabled={disabled}
				aria-label={label}
			/>
		</div>
	);
}
