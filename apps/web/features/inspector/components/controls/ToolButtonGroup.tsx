import type { ComponentChildren, JSX } from "preact";

/** Props for {@link ToolButtonGroup}. */
export interface ToolButtonGroupProps {
	/** Accessible name of the group, e.g. "Zoom". */
	label: string;
	children: ComponentChildren;
}

/** A row of related {@link ToolButton}s announced as one group. */
export function ToolButtonGroup({ label, children }: ToolButtonGroupProps): JSX.Element {
	return (
		<div class="ins-tool-buttons" role="group" aria-label={label}>
			{children}
		</div>
	);
}
