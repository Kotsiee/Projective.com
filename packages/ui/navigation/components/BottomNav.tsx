import type { JSX, VNode } from "preact";
import "../styles/bottom-nav.css";
import { cx } from "../../core/cx.ts";

// #region Types
/** A single bottom-nav destination. */
export interface BottomNavItem {
	href: string;
	/** Short label under the icon. */
	label: string;
	/** Leading glyph (a `VNode` — the app owns its icon set; the package stays icon-agnostic). */
	icon: VNode;
	active?: boolean;
	/** Unseen-update indicator — a pulsing dot, never a count (Part D). */
	dot?: boolean;
}

/** Props for {@link BottomNav}. */
export interface BottomNavProps {
	/** The destinations (exactly the thumb-reachable primaries — typically 3–5). */
	items: BottomNavItem[];
	/** Accessible landmark name (default "Primary"). */
	label?: string;
}
// #endregion

/**
 * BottomNav — the ergonomic sticky bottom utility bar for the mobile shell (DESIGN_SYSTEM.md Part
 * D.3). A `position: fixed` glass bar of equal-width icon+label destinations, thumb-reachable at the
 * base of the viewport. **Mobile-only**: it is `display: none` above `--bp-md` (the desktop shell uses
 * the sidebar), so the same shell can render it unconditionally. Zero-JS — active state and update
 * dots are resolved server-side from the route.
 */
export function BottomNav({ items, label = "Primary" }: BottomNavProps): JSX.Element {
	return (
		<nav class="ui-bottom-nav" aria-label={label}>
			{items.map((it) => (
				<a
					key={it.href}
					href={it.href}
					class={cx("ui-bottom-nav__item", it.active && "ui-bottom-nav__item--active")}
					aria-current={it.active ? "page" : undefined}
				>
					<span class="ui-bottom-nav__icon" aria-hidden="true">
						{it.icon}
						{it.dot ? <span class="ui-bottom-nav__dot" /> : null}
					</span>
					<span class="ui-bottom-nav__label">{it.label}</span>
					{it.dot ? <span class="ui-visually-hidden">has updates</span> : null}
				</a>
			))}
		</nav>
	);
}
