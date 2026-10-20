import type { ComponentChildren, JSX, VNode } from "preact";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for `EmptyState`. */
export interface EmptyStateProps {
	/** Optional leading illustration/icon node, shown above the title. */
	icon?: VNode;
	/** Primary heading describing the empty condition. */
	title: string;
	/**
	 * Render the title as a heading of this level instead of a paragraph — only when the empty state
	 * IS the page's subject (the error page's `1`), so the page keeps its one `<h1>`. The look is the
	 * same at every level (`.ui-empty__title`).
	 */
	heading?: 1 | 2 | 3;
	/** Secondary explanatory copy. */
	description?: string;
	/**
	 * Optional body content between the description and the actions — a short list of what the empty
	 * thing would do, for a first-run screen. Body text, never a control; capped at the description's
	 * measure. Omitted (or `false` / `null`), nothing renders.
	 */
	children?: ComponentChildren;
	/** Action slot (typically one or two buttons) rendered below the copy. */
	actions?: ComponentChildren;
	/** Vertical density ramp (default `md`). */
	size?: "sm" | "md" | "lg";
	class?: string;
}
// #endregion

/**
 * The EmptyState markup, kept free of the stylesheet import so the contract is unit-testable (the
 * MetaLine precedent); the public component is `components/EmptyState.tsx`, which adds the
 * stylesheet. Order: icon · title · description · body (`children`) · actions.
 */
export function EmptyStateMarkup(props: EmptyStateProps): JSX.Element {
	const { icon, title, heading, description, children, actions, size = "md", class: className } =
		props;
	const Title = heading ? (`h${heading}` as const) : "p";

	return (
		<div class={cx("ui-empty", `ui-empty--${size}`, className)} role="status">
			{icon && <div class="ui-empty__icon" aria-hidden="true">{icon}</div>}
			<Title class="ui-empty__title">{title}</Title>
			{description && <p class="ui-empty__description">{description}</p>}
			{children && <div class="ui-empty__body">{children}</div>}
			{actions && <div class="ui-empty__actions">{actions}</div>}
		</div>
	);
}
