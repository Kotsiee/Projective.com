import type { JSX } from "preact";
import type { CatalogueKind } from "../types/catalogue-types.ts";
import { IconShell } from "@projective/ui/icons";

/**
 * catalogue-glyphs — the Catalogue surface's inline-SVG icon set. Every glyph is a COMPONENT returning
 * a fresh VNode (not a shared constant), so rendering the same icon across many virtualized cards never
 * trips the Preact VNode-reuse hazard. Stroke-based, `currentColor`, 24×24 viewBox — byte-consistent
 * with the projects/messaging glyph conventions (stroke-width 1.7) for cross-surface parity (§B.6).
 * Token-only via `currentColor`.
 */

interface GlyphProps {
	size?: number;
	class?: string;
}

function svg(size: number, className: string | undefined, children: JSX.Element): JSX.Element {
	return <IconShell size={size} class={className}>{children}</IconShell>;
}

// #region Kind / surface
export function BoxIcon({ size = 20, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
			<path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
		</>,
	);
}
export function ServiceIcon({ size = 20, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8L12 3z" />
		</>,
	);
}
export function CatalogueIcon({ size = 20, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="3.5" y="4" width="7" height="7" rx="1.4" />
			<rect x="13.5" y="4" width="7" height="7" rx="1.4" />
			<rect x="3.5" y="14" width="7" height="6" rx="1.4" />
			<path d="M14 16.5h6M14 19h4" />
		</>,
	);
}
/** The kind glyph for a listing — a component (fresh VNode per render). */
export function KindIcon(
	{ kind, size = 20, class: c }: GlyphProps & { kind: CatalogueKind },
): JSX.Element {
	return kind === "service"
		? <ServiceIcon size={size} class={c} />
		: <BoxIcon size={size} class={c} />;
}
// #endregion

// #region Actions
export function PlusIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M12 5v14M5 12h14" />);
}
export function SearchIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="M20 20l-3.5-3.5" />
		</>,
	);
}
export function FilterIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M4 6h16M7 12h10M10 18h4" />);
}
/** The Smart-Filter trigger glyph — byte-identical to the `/projects` (and `/messages`) SlidersIcon so
 * the filter control reads the same across every lane surface (§B.6 iconographic parity). */
export function SlidersIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
			<circle cx="16" cy="7" r="2.2" />
			<circle cx="8" cy="17" r="2.2" />
		</>,
	);
}
export function GridIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="4" y="4" width="7" height="7" rx="1.4" />
			<rect x="13" y="4" width="7" height="7" rx="1.4" />
			<rect x="4" y="13" width="7" height="7" rx="1.4" />
			<rect x="13" y="13" width="7" height="7" rx="1.4" />
		</>,
	);
}
export function ListIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />);
}
export function KebabIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<circle cx="12" cy="5" r="1.4" fill="currentColor" />
			<circle cx="12" cy="12" r="1.4" fill="currentColor" />
			<circle cx="12" cy="19" r="1.4" fill="currentColor" />
		</>,
	);
}
export function CloseIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M6 6l12 12M18 6L6 18" />);
}
export function EditIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 20h4l10-10-4-4L4 16v4z" />
			<path d="M13.5 6.5l4 4" />
		</>,
	);
}
export function DuplicateIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="8" y="8" width="12" height="12" rx="2" />
			<path d="M4 16V6a2 2 0 0 1 2-2h10" />
		</>,
	);
}
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
export function ChevronDownIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M6 9l6 6 6-6" />);
}
// #endregion

// #region Quick filters / status signals
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
export function StarGlyph(
	{ size = 18, class: c, filled }: GlyphProps & { filled?: boolean },
): JSX.Element {
	return (
		<IconShell size={size} class={c} filled={filled}>
			<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
		</IconShell>
	);
}
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
export function ChartIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 20V4M20 20H4" />
			<path d="M8 16v-4M12 16V8M16 16v-6" />
		</>,
	);
}
export function TagIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 4h7l9 9-7 7-9-9V4z" />
			<circle cx="8" cy="8" r="1.4" fill="currentColor" />
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
export function ClockIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 8v4l3 2" />
		</>,
	);
}
// #endregion
