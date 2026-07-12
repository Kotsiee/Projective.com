import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/tag.css";
import { cx } from "../../core/cx.ts";
import type { Severity } from "../../fields/types/mod.ts";

/** Fill treatment for {@link Tag} (PrimeNG parity). */
export type TagVariant = "filled" | "outlined" | "subtle";

export interface TagProps {
	/** Label text; falls back to `children` when omitted. */
	value?: string;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Leading icon node. */
	icon?: VNode;
	/** Pill corners. */
	rounded?: boolean;
	/** Fill treatment (default `filled`). */
	variant?: TagVariant;
	class?: string;
	children?: ComponentChildren;
}

/**
 * Tag — a small status label. Unlike Card/Badge this is a compact inline marker (not a content
 * region), so the `outlined` variant's full hairline is acceptable — it reads as a chip affordance,
 * not a boundary around a block of content. Zero client JS.
 */
export function Tag(props: TagProps): JSX.Element {
	const { value, severity = "primary", icon, rounded, variant = "filled", class: className, children } =
		props;

	return (
		<span
			class={cx(
				"ui-tag",
				`ui-tag--${severity}`,
				`ui-tag--${variant}`,
				rounded && "ui-tag--rounded",
				className,
			)}
		>
			{icon && (
				<span class="ui-tag__icon" aria-hidden="true">
					{icon}
				</span>
			)}
			<span class="ui-tag__label">{value ?? children}</span>
		</span>
	);
}
