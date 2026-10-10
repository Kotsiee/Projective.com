import type { Signal } from "@preact/signals";
import type { JSX } from "preact";
import { type Option, SelectButton } from "@projective/ui/fields";

/** One segment of a {@link ToolChoice}. */
export interface ToolChoiceOption<V extends string = string> {
	value: V;
	label: string;
	disabled?: boolean;
}

/** Props for {@link ToolChoice}. */
export interface ToolChoiceProps<V extends string = string> {
	/** Accessible name of the choice, shown above the segments. */
	label: string;
	options: readonly ToolChoiceOption<V>[];
	value: Signal<V>;
	disabled?: boolean;
}

/** A segmented choice between a few short text options, bound to a signal. */
export function ToolChoice<V extends string>(props: ToolChoiceProps<V>): JSX.Element {
	const { label, options, value, disabled } = props;
	const segments: Option[] = options.map((o) => ({
		value: o.value,
		label: o.label,
		disabled: o.disabled,
	}));
	return (
		<div class="ins-tool-choice">
			<span class="ins-tool-choice__label" aria-hidden="true">{label}</span>
			<SelectButton
				class="ins-tool-choice__control"
				size="sm"
				fluid
				aria-label={label}
				options={segments}
				value={value}
				disabled={disabled}
			/>
		</div>
	);
}
