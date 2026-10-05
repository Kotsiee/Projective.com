import type { ComponentChildren, JSX } from "preact";
import "../styles/nav.css";
import { cx } from "../../core/cx.ts";

export interface NavItemProps {
	href: string;
	/** Text label — shown when the sidebar/lane is expanded; the accessible name otherwise. */
	label: string;
	/** Leading icon (kept visible in the collapsed rail). */
	icon?: ComponentChildren;
	/**
	 * Whether this is the reader's current destination. `true` (or `"page"`) marks the page itself;
	 * `"true"` marks a SECTION the reader is somewhere inside — a link that stays lit on the pages
	 * beneath it announces `aria-current="true"`, because claiming `"page"` there would tell a screen
	 * reader they are on a page they have left. Both paint the active state.
	 */
	active?: boolean | "page" | "true";
	/**
	 * Show an update indicator — a small pulsing dot on the icon (§B.4 non-color channel: paired with
	 * visually-hidden text). Signals "has updates" without a raw count or text badge (Part D).
	 */
	dot?: boolean;
	/** Accessible phrase announced for the dot (default "has updates"). */
	dotLabel?: string;
	/**
	 * A trailing status mark at the row's end — a lane's unread dot, a state glyph. Decorative: it is
	 * `aria-hidden`, so its meaning must also travel in the accessible name (pass {@link dot} +
	 * {@link dotLabel}). Expanded only — it is removed with the label in a collapsed rail, where the
	 * square has no row end to hold it.
	 */
	trailing?: ComponentChildren;
}

/**
 * NavItem — a sidebar/lane destination. The icon stays on the shared centerline; the label reveals
 * on expand without shifting the icon axis (DESIGN_SYSTEM.md Part D.1). Never uses a native `title`
 * tooltip — the collapsed rail wraps items in the real `Tooltip` component (§C.1) for its label.
 */
export function NavItem(
	{ href, label, icon, active, dot, dotLabel = "has updates", trailing }: NavItemProps,
): JSX.Element {
	const current = active === true ? "page" : active || undefined;
	return (
		<a
			href={href}
			class={cx("ui-nav-item", active && "ui-nav-item--active")}
			aria-current={current}
			// Explicit name so the icon-only collapsed rail is never nameless (its visible label is
			// hidden). Folds in the dot state so the update is announced without a text badge.
			aria-label={dot ? `${label} — ${dotLabel}` : label}
		>
			<span class="ui-nav-item__icon" aria-hidden="true">
				{icon}
			</span>
			<span class="ui-nav-item__label">{label}</span>
			{trailing && <span class="ui-nav-item__trailing" aria-hidden="true">{trailing}</span>}
		</a>
	);
}
