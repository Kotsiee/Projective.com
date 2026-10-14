import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * catalogue-glyphs — the Catalogue's own glyphs: the ones `@projective/ui/icons` has no entry for
 * (publish, trend), plus the few the item-workspace islands still import until they move to `Icon`.
 * Everything else renders through `Icon(...)`. Each glyph is a component returning a fresh VNode, so
 * many virtualized cards never share one.
 */

interface GlyphProps {
	size?: number;
	class?: string;
}

function svg(size: number, className: string | undefined, children: JSX.Element): JSX.Element {
	return <IconShell size={size} class={className}>{children}</IconShell>;
}

// #region Catalogue-only
/** Publish — an arrow rising to a line. */
export function PublishIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 20V8M7 12l5-5 5 5" />
			<path d="M5 4h14" />
		</>,
	);
}

/** Best-selling — a rising trend line. */
export function TrendIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 15l5-5 3 3 6-7" />
			<path d="M14 6h5v5" />
		</>,
	);
}
// #endregion

// #region Workspace (until it moves to Icon)
export function EyeIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
			<circle cx="12" cy="12" r="2.6" />
		</>,
	);
}
export function PauseIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M9 5v14M15 5v14" />
		</>,
	);
}
export function ArchiveIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" />
			<path d="M3 4h18v3H3zM10 11h4" />
		</>,
	);
}
export function CheckIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M5 12.5l4.5 4.5L19 7" />);
}
export function RetryIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M20 12a8 8 0 1 1-2.7-6" />
			<path d="M20 4v5h-5" />
		</>,
	);
}
export function AlertIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 4l9 16H3l9-16z" />
			<path d="M12 10v4M12 17h.01" />
		</>,
	);
}
export function ImageIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<circle cx="8.5" cy="9.5" r="1.6" />
			<path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 21" />
		</>,
	);
}
// #endregion
