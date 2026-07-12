import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/empty-state.css";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
	/** Optional leading illustration/icon node, shown above the title. */
	icon?: VNode;
	/** Primary heading describing the empty condition. */
	title: string;
	/** Secondary explanatory copy. */
	description?: string;
	/** Action slot (typically one or two buttons) rendered below the copy. */
	actions?: ComponentChildren;
	/** Vertical density ramp (default `md`). */
	size?: "sm" | "md" | "lg";
	class?: string;
}
// #endregion

/**
 * EmptyState — a zero-JS placeholder for empty collections, zero-result searches, and first-run
 * screens. Centres an optional icon, a title, supporting copy and an actions slot on a tonal surface
 * tint with no four-sided border (separation via spacing + tint, §B.4). Announced as a `status`
 * region so assistive tech reads the reason a view is empty.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element {
	const { icon, title, description, actions, size = "md", class: className } = props;

	return (
		<div class={cx("ui-empty", `ui-empty--${size}`, className)} role="status">
			{icon && <div class="ui-empty__icon" aria-hidden="true">{icon}</div>}
			<p class="ui-empty__title">{title}</p>
			{description && <p class="ui-empty__description">{description}</p>}
			{actions && <div class="ui-empty__actions">{actions}</div>}
		</div>
	);
}
