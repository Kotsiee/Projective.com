import type { ComponentChildren, JSX } from "preact";
import { useId } from "@projective/ui/hooks";

/** Props for {@link ToolGroup}. */
export interface ToolGroupProps {
	/** Section title, in the section-header register. */
	title: string;
	children: ComponentChildren;
}

/** A titled run of panel controls, separated from its neighbours by spacing alone. */
export function ToolGroup({ title, children }: ToolGroupProps): JSX.Element {
	const titleId = useId(undefined, "ins-tools");
	return (
		<section class="ins-tools" aria-labelledby={titleId}>
			<h3 id={titleId} class="ins-tools__title">{title}</h3>
			<div class="ins-tools__body">{children}</div>
		</section>
	);
}
