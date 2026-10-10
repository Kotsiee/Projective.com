import type { JSX } from "preact";

/** Props for {@link ToolReadout}. */
export interface ToolReadoutProps {
	/** The formatted figure, e.g. `"150%"` or `"3 / 12"`. */
	value: string;
	/** Spoken before the figure when it is ambiguous on its own, e.g. "Zoom level". */
	label?: string;
}

/** A changing figure set in tabular numerals so it does not jitter as it updates. */
export function ToolReadout({ value, label }: ToolReadoutProps): JSX.Element {
	return (
		<span class="ins-readout">
			{label ? <span class="ui-visually-hidden">{`${label}: `}</span> : null}
			{value}
		</span>
	);
}
