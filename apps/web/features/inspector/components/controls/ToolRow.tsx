import type { ComponentChildren, JSX } from "preact";

/** Props for {@link ToolRow}. */
export interface ToolRowProps {
	/** What the control does. */
	label: string;
	/** The id of the labelled control; makes the label a real `<label for>`. */
	for?: string;
	children: ComponentChildren;
}

/** A label on the start side and its control on the end side. */
export function ToolRow({ label, for: htmlFor, children }: ToolRowProps): JSX.Element {
	return (
		<div class="ins-tool-row">
			{htmlFor
				? <label class="ins-tool-row__label" for={htmlFor}>{label}</label>
				: <span class="ins-tool-row__label">{label}</span>}
			<div class="ins-tool-row__control">{children}</div>
		</div>
	);
}
