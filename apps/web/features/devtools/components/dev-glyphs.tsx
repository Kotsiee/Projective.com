import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * dev-glyphs.tsx — the icon set for the Developer Tools suite.
 *
 * Each glyph is a small functional component (not a shared VNode constant) so it can be rendered many
 * times — e.g. one severity glyph per inspector row — without tripping Preact's VNode-reuse guard.
 * All are token-driven (`currentColor`), inheriting size/colour from the button they sit in.
 */

/** Shared SVG frame for a 20×20 stroked glyph. */
function Svg(props: { children: JSX.Element | JSX.Element[]; size?: number }): JSX.Element {
	return <IconShell size={props.size ?? 20}>{props.children}</IconShell>;
}

// #region Speed-dial actions
/** The dev FAB trigger — a terminal/console mark. */
export function IconDevTools(): JSX.Element {
	return (
		<Svg size={22}>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<path d="m7 9 3 3-3 3M13 15h4" />
		</Svg>
	);
}

/** Context switcher — two arrows (swap persona). */
export function IconSwitch(): JSX.Element {
	return (
		<Svg>
			<path d="M4 8h13l-3-3M20 16H7l3 3" />
		</Svg>
	);
}

/** Log inspector — a list with a magnifier hint. */
export function IconInspector(): JSX.Element {
	return (
		<Svg>
			<path d="M4 6h10M4 12h7M4 18h5" />
			<circle cx="17" cy="15" r="3.2" />
			<path d="m21 19-1.8-1.8" />
		</Svg>
	);
}

/** Clear cache — a broom / sweep. */
export function IconClearCache(): JSX.Element {
	return (
		<Svg>
			<path d="M14 4 20 10M18 6l-8.5 8.5a3 3 0 0 0-.8 1.5L8 20l4-0.7a3 3 0 0 0 1.5-.8L22 10" />
			<path d="M4 20h5" />
		</Svg>
	);
}

/** Ownership toggle — a key. */
export function IconOwnership(): JSX.Element {
	return (
		<Svg>
			<circle cx="8" cy="8" r="4" />
			<path d="m11 11 8 8M16 16l2-2M18 18l2-2" />
		</Svg>
	);
}

/** Pending-invites toggle — an envelope with a plus. */
export function IconInvites(): JSX.Element {
	return (
		<Svg>
			<path d="M3 6.5h13v8H3z" />
			<path d="m3 7 6.5 5L16 7" />
			<path d="M19 13v6M16 16h6" />
		</Svg>
	);
}
// #endregion

// #region Severity
/** Info — an i in a circle. */
export function IconInfo(): JSX.Element {
	return (
		<Svg size={16}>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v5M12 8h.01" />
		</Svg>
	);
}

/** Warning — a bang in a triangle. */
export function IconWarn(): JSX.Element {
	return (
		<Svg size={16}>
			<path d="M12 4 22 19H2L12 4Z" />
			<path d="M12 10v4M12 17h.01" />
		</Svg>
	);
}

/** Error — an x in a circle. */
export function IconError(): JSX.Element {
	return (
		<Svg size={16}>
			<circle cx="12" cy="12" r="9" />
			<path d="m9 9 6 6M15 9l-6 6" />
		</Svg>
	);
}

/** Network — up/down transfer arrows. */
export function IconNetwork(): JSX.Element {
	return (
		<Svg size={16}>
			<path d="M7 4v13l-3-3M17 20V7l3 3" />
		</Svg>
	);
}
// #endregion

// #region Controls
/** Disclosure chevron (points right when collapsed; CSS rotates it open). */
export function IconChevron(): JSX.Element {
	return (
		<Svg size={14}>
			<path d="m9 6 6 6-6 6" />
		</Svg>
	);
}

/** Search magnifier. */
export function IconSearch(): JSX.Element {
	return (
		<Svg size={16}>
			<circle cx="11" cy="11" r="6.5" />
			<path d="m20 20-3.5-3.5" />
		</Svg>
	);
}

/** Sort direction (two stacked arrows). */
export function IconSort(): JSX.Element {
	return (
		<Svg size={16}>
			<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" />
		</Svg>
	);
}

/** Reset / rotate. */
export function IconReset(): JSX.Element {
	return (
		<Svg size={16}>
			<path d="M4 9a8 8 0 1 1-.7 5" />
			<path d="M4 4v5h5" />
		</Svg>
	);
}
// #endregion
