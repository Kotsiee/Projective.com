import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * catalogue-glyphs — the Catalogue's own glyphs: the ones `@projective/ui/icons` has no entry for.
 * Everything else renders through `Icon(...)`. Each glyph is a component returning a fresh VNode, so
 * many virtualized rows never share one.
 */

interface GlyphProps {
	size?: number;
	class?: string;
}

// #region Catalogue-only
/** Best-selling — a rising trend line. */
export function TrendIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return (
		<IconShell size={size} class={c}>
			<path d="M4 15l5-5 3 3 6-7" />
			<path d="M14 6h5v5" />
		</IconShell>
	);
}
// #endregion
