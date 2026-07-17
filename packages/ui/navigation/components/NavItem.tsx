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
	/**
	 * Show an update indicator — a small pulsing dot on the icon (§B.4 non-color channel: paired with
	 * visually-hidden text). Signals "has updates" without a raw count or text badge (Part D).
	 */
	dot?: boolean;
	/** Accessible phrase announced for the dot (default "has updates"). */
	dotLabel?: string;
}

/**
 * NavItem — a sidebar/lane destination. The icon stays on the shared centerline; the label reveals
 * on expand without shifting the icon axis (DESIGN_SYSTEM.md Part D.1). Never uses a native `title`
 * tooltip — the collapsed rail wraps items in the real `Tooltip` component (§C.1) for its label.
 */
export function NavItem(
	{ href, label, icon, active, dot, dotLabel = "has updates" }: NavItemProps,
): JSX.Element {
	return (
		<a
			href={href}
			class={cx("ui-nav-item", active && "ui-nav-item--active")}
			aria-current={active ? "page" : undefined}
			// Explicit name so the icon-only collapsed rail is never nameless (its visible label is
			// hidden). Folds in the dot state so the update is announced without a text badge.
			aria-label={dot ? `${label} — ${dotLabel}` : label}
		>
			<span class="ui-nav-item__icon" aria-hidden="true">
				{icon}
				{dot ? <span class="ui-nav-item__dot" /> : null}
			</span>
			<span class="ui-nav-item__label">{label}</span>
		</a>
	);
}
