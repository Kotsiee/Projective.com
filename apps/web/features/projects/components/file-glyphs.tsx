import type { JSX } from "preact";
import type { FileKind } from "../types/projects-types.ts";
import { IconShell } from "@projective/ui/icons";

/**
 * file-glyphs — the File Explorer's inline-SVG icon set. Every glyph is a COMPONENT returning a fresh
 * VNode (not a shared constant), so rendering the same icon across hundreds of virtualized rows never
 * trips the Preact VNode-reuse hazard and needs no `cloneElement`. Stroke-based, `currentColor`,
 * 24×24 viewBox — matching the existing channel/detail glyph conventions. Token-only via `currentColor`.
 */

interface GlyphProps {
	size?: number;
	class?: string;
}

function svg(size: number, className: string | undefined, children: JSX.Element): JSX.Element {
	return <IconShell size={size} class={className}>{children}</IconShell>;
}

// #region Category glyphs
export function ImageGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
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
export function VideoGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="3" y="5" width="18" height="14" rx="2.5" />
			<path d="M10 9.5l4.5 2.5L10 14.5z" fill="currentColor" stroke="none" />
		</>,
	);
}
export function AudioGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M9 18V7l9-2v11" />
			<circle cx="6.5" cy="18" r="2.5" />
			<circle cx="15.5" cy="16" r="2.5" />
		</>,
	);
}
export function PdfGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
			<path d="M14 3v4h4" />
			<path d="M8.5 15.5h1.2a1.3 1.3 0 0 0 0-2.6H8.5V18M13 12.9V18M13 12.9h1.8M13 15.4h1.4" />
		</>,
	);
}
export function DocGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
			<path d="M14 3v4h4" />
			<path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.5h4" />
		</>,
	);
}
export function CodeGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<path d="M9.5 10L7 12.5l2.5 2.5M14.5 10l2.5 2.5-2.5 2.5" />
		</>,
	);
}
export function ArchiveGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="4" y="4" width="16" height="16" rx="2.5" />
			<path d="M12 4v4M12 10v2M12 14v2" />
			<rect x="10.5" y="15.5" width="3" height="3.5" rx="0.8" />
		</>,
	);
}
export function FileGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
			<path d="M14 3v4h4" />
		</>,
	);
}

/** The category glyph for a file kind — a component (fresh VNode per render). */
export function FileKindIcon(
	{ kind, size = 24, class: c }: GlyphProps & { kind: FileKind },
): JSX.Element {
	switch (kind) {
		case "image":
			return <ImageGlyph size={size} class={c} />;
		case "video":
			return <VideoGlyph size={size} class={c} />;
		case "audio":
			return <AudioGlyph size={size} class={c} />;
		case "pdf":
			return <PdfGlyph size={size} class={c} />;
		case "doc":
			return <DocGlyph size={size} class={c} />;
		case "code":
			return <CodeGlyph size={size} class={c} />;
		case "archive":
			return <ArchiveGlyph size={size} class={c} />;
		default:
			return <FileGlyph size={size} class={c} />;
	}
}
// #endregion

// #region Toolbar / action glyphs
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
export function DownloadIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 4v11M8 11l4 4 4-4" />
			<path d="M5 19h14" />
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
export function ChevronLeftIcon({ size = 22, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M14.5 5l-7 7 7 7" />);
}
export function ChevronRightIcon({ size = 22, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M9.5 5l7 7-7 7" />);
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
export function ChannelHashIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M9 4L7 20M17 4l-2 16M5 9h14M4 15h14" />);
}
export function DmBubbleIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M4 5h16v10H9l-5 4V5z" />);
}
export function PlayIcon({ size = 22, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none" />);
}
export function ChevronDownIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M6 9l6 6 6-6" />);
}
// #endregion
