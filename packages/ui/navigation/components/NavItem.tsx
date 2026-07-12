import type { ComponentChildren, JSX } from "preact";
import "../styles/nav.css";
import { cx } from "../../core/cx.ts";

export interface NavItemProps {
	href: string;
	/** Text label — shown when the sidebar/lane is expanded; the accessible name otherwise. */
	label: string;
	/** Leading icon (kept visible in the collapsed rail). */
	icon?: ComponentChildren;
	active?: boolean;
}

/**
 * NavItem — a sidebar/lane destination. The icon stays on the shared centerline; the label reveals
 * on expand without shifting the icon axis (DESIGN_SYSTEM.md Part D.1).
 */
export function NavItem({ href, label, icon, active }: NavItemProps): JSX.Element {
	return (
		<a
			href={href}
			class={cx("ui-nav-item", active && "ui-nav-item--active")}
			aria-current={active ? "page" : undefined}
			title={label}
		>
			<span class="ui-nav-item__icon" aria-hidden="true">{icon}</span>
			<span class="ui-nav-item__label">{label}</span>
		</a>
	);
}
