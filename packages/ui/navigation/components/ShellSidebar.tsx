import type { ComponentChildren, JSX } from "preact";
import "../styles/sidebar.css";
import { cx } from "../../core/cx.ts";

export interface ShellSidebarProps {
	/** Expanded (labels visible, `--shell-sidebar-w-expanded`) vs collapsed icon rail. */
	expanded?: boolean;
	/** Accessible label for the landmark (default "Global navigation"). */
	label?: string;
	/** Primary destination items (NavItem). */
	children?: ComponentChildren;
	/** Pinned footer slot (account switcher, settings). */
	footer?: ComponentChildren;
}

/**
 * ShellSidebar — the Red-zone global navigation rail. Icons align on one vertical centerline at both
 * widths; padding tokens keep the axis stable between collapsed/expanded (DESIGN_SYSTEM.md Part D.1).
 */
export function ShellSidebar(
	{ expanded = false, label = "Global navigation", children, footer }: ShellSidebarProps,
): JSX.Element {
	return (
		<nav
			class={cx("ui-shell-sidebar", expanded && "ui-shell-sidebar--expanded")}
			aria-label={label}
		>
			<div class="ui-shell-sidebar__items">{children}</div>
			{footer ? <div class="ui-shell-sidebar__footer">{footer}</div> : null}
		</nav>
	);
}
