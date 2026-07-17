import type { JSX, VNode } from "preact";

/**
 * nav-icons — the shell's inline SVG glyph set. `@projective/ui` is deliberately icon-library
 * agnostic (no `Icon` component; components take `VNode` icon slots), so the app owns its own
 * stroke-consistent set here and references glyphs by a typed {@link IconName}. Every glyph is a
 * 24×24 line icon using `currentColor` so it inherits the nav item's text color and theme crossfade.
 */

// #region Names
/** Every glyph the navigation shell can render. */
export type IconName =
	| "home"
	| "explore"
	| "messages"
	| "projects"
	| "services"
	| "teams"
	| "business"
	| "dashboard"
	| "wallet"
	| "settings"
	| "create"
	| "notifications"
	| "basket"
	| "search"
	| "chevron"
	| "sidebar"
	| "product"
	| "article"
	| "user"
	| "logout";
// #endregion

const PATHS: Record<IconName, VNode> = {
	home: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
	explore: (
		<>
			<circle cx="12" cy="12" r="9" />
			<polygon points="15.6 8.4 13.3 13.3 8.4 15.6 10.7 10.7" />
		</>
	),
	messages: <path d="M4 5h16v11H9l-4 3v-3H4z" />,
	projects: (
		<>
			<path d="M4 21V10a8 8 0 0 1 16 0v11" />
			<path d="M4 21h16" />
			<path d="M9.5 21v-5.5a2.5 2.5 0 0 1 5 0V21" />
		</>
	),
	services: <path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 8v5m18-5v5" />,
	teams: (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6m1 8a6 6 0 0 0-3-5" />
		</>
	),
	business: (
		<>
			<path d="M4 21V5l8-2v18M12 9h8v12M8 8v0M8 12v0M8 16v0" />
			<path d="M15 13v0M15 17v0" />
		</>
	),
	dashboard: (
		<>
			<path d="M4 13a8 8 0 0 1 16 0" />
			<path d="M12 13 15 9" />
			<path d="M4 13v4h16v-4" />
		</>
	),
	wallet: (
		<>
			<rect x="3" y="6" width="18" height="13" rx="2" />
			<path d="M3 10h18M16 14h2" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
		</>
	),
	create: <path d="M12 5v14M5 12h14" />,
	notifications: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 21a2 2 0 0 0 4 0" />,
	basket: <path d="M5 8h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8zM9 8 12 3l3 5" />,
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.2-3.2" />
		</>
	),
	chevron: <path d="m9 6 6 6-6 6" />,
	sidebar: (
		<>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path d="M9 4v16" />
		</>
	),
	product: (
		<>
			<path d="M12 3 4 7v10l8 4 8-4V7z" />
			<path d="M4 7l8 4 8-4M12 11v10" />
		</>
	),
	article: (
		<>
			<rect x="5" y="3" width="14" height="18" rx="2" />
			<path d="M8 8h8M8 12h8M8 16h5" />
		</>
	),
	user: (
		<>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 20a8 8 0 0 1 16 0" />
		</>
	),
	logout: (
		<>
			<path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
			<path d="M10 8l-4 4 4 4M6 12h9" />
		</>
	),
};

/**
 * NavIcon — renders a shell glyph by name. Stroke-based, `currentColor`, `aria-hidden` (the label
 * carries the accessible name). Extra SVG props (e.g. `class`) are forwarded to the root `<svg>`.
 */
export function NavIcon(
	{ name, ...svg }: { name: IconName } & JSX.SVGAttributes<SVGSVGElement>,
): VNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			{...svg}
		>
			{PATHS[name]}
		</svg>
	);
}

/**
 * SidebarToggleIcon — the custom sidebar collapse/expand glyph: a rounded square framing a vertical
 * dotted divider. The divider **morphs** between the left (collapsed) and right (expanded) edges via a
 * CSS transform on `.shell-toggle__bar`, keyed off `:root[data-sidebar]` (sidebar.css) — not a static
 * icon swap. Reduced-motion collapses the transition to an instant jump (global rule).
 */
export function SidebarToggleIcon(): VNode {
	return (
		<svg
			class="shell-toggle"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<rect x="3" y="4" width="18" height="16" rx="3.5" />
			<line class="shell-toggle__bar" x1="9" y1="7.5" x2="9" y2="16.5" stroke-dasharray="0.1 3" />
		</svg>
	);
}
