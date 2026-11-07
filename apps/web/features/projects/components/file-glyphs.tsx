import type { JSX } from "preact";
import type { FileFamily } from "@projective/types/files";
import type { FileKind } from "../types/projects-types.ts";
import { IconShell } from "@projective/ui/icons";

/**
 * file-glyphs — the File Explorer's inline-SVG icon set. Every glyph is a COMPONENT returning a fresh
 * VNode (not a shared constant), so rendering the same icon across hundreds of virtualized rows never
 * trips the Preact VNode-reuse hazard and needs no `cloneElement`. Stroke-based, `currentColor`,
 * 24×24 viewBox — matching the existing channel/detail glyph conventions. Token-only via `currentColor`.
 * The file glyphs share a 2-unit inset and a corner radius of 2, and sit centred on the grid.
 */

/** The page every document glyph is drawn on, and its fold: one silhouette, one radius, centred. */
const PAGE = "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z";
const FOLD = "M14 3v5h5";

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
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<circle cx="8.5" cy="9.5" r="1.6" />
			<path d="M3 16l4.6-4.6a2 2 0 0 1 2.8 0L19 20" />
		</>,
	);
}
export function VideoGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<path d="M10 9.5l4.5 2.5L10 14.5z" fill="currentColor" stroke="none" />
		</>,
	);
}
export function AudioGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M10 17.5v-11l9-2v11" />
			<circle cx="7.5" cy="17.5" r="2.5" />
			<circle cx="16.5" cy="15.5" r="2.5" />
		</>,
	);
}
export function PdfGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d={PAGE} />
			<path d={FOLD} />
			<path d="M8.5 15.5h1.2a1.3 1.3 0 0 0 0-2.6H8.5V18M13 12.9V18M13 12.9h1.8M13 15.4h1.4" />
		</>,
	);
}
export function DocGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d={PAGE} />
			<path d={FOLD} />
			<path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.5h4" />
		</>,
	);
}
export function CodeGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path d="M9.5 10L7 12.5l2.5 2.5M14.5 10l2.5 2.5-2.5 2.5" />
		</>,
	);
}
export function ArchiveGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="4" y="4" width="16" height="16" rx="2" />
			<path d="M12 4v4M12 10v2M12 14v2" />
			<rect x="10.5" y="15.5" width="3" height="3.5" rx="1.5" />
		</>,
	);
}
export function FileGlyph({ size = 24, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d={PAGE} />
			<path d={FOLD} />
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

function familyPaths(family: FileFamily): JSX.Element {
	switch (family) {
		case "spreadsheet":
			return (
				<>
					<rect x="4" y="4.5" width="16" height="15" rx="2" />
					<path d="M4 9.5h16M4 14.5h16M10 4.5v15" />
				</>
			);
		case "document":
			return <path d="M5 5.25h14M5 9.75h14M5 14.25h14M5 18.75h8" />;
		case "presentation":
			return (
				<>
					<rect x="3" y="4" width="18" height="12.5" rx="2" />
					<path d="M12 16.5V20M8 20h8" />
				</>
			);
		case "pdf":
			return (
				<>
					<path d={PAGE} />
					<path d={`${FOLD}M9 13h6M9 17h6`} />
				</>
			);
		case "image":
			return (
				<>
					<rect x="3" y="4" width="18" height="16" rx="2" />
					<circle cx="8.5" cy="9.5" r="1.6" />
					<path d="M3 16l4.6-4.6a2 2 0 0 1 2.8 0L19 20" />
				</>
			);
		case "video":
			return <path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" />;
		case "audio":
			return (
				<>
					<path d="M10 17.5v-11l9-2v11" />
					<circle cx="7.5" cy="17.5" r="2.5" />
					<circle cx="16.5" cy="15.5" r="2.5" />
				</>
			);
		case "code":
			return <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />;
		case "model":
			return (
				<>
					<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
					<path d="M12 12l8-4.5M12 12L4 7.5M12 12v9" />
				</>
			);
		case "archive":
			return (
				<>
					<rect x="3" y="4" width="18" height="5" rx="2" />
					<path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
				</>
			);
		case "link":
			return (
				<>
					<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1" />
					<path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
				</>
			);
		default:
			return (
				<>
					<path d={PAGE} />
					<path d={FOLD} />
				</>
			);
	}
}

/**
 * The mark inside a {@link FileTypeIcon} tile. Drawn without a page outline, because the tile already
 * is the frame and a sheet of paper inside a square reads as noise at list-row size. Every family
 * keeps a distinct silhouette, so the type survives a colour-blindness overlay. Unsized by default:
 * the tile's stylesheet scales the glyph with the tile.
 */
export function FileFamilyGlyph(
	{ family, size, class: c }: { family: FileFamily; size?: number; class?: string },
): JSX.Element {
	return <IconShell size={size} class={c}>{familyPaths(family)}</IconShell>;
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
export function ChannelHashIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M9 4L7 20M17 4l-2 16M5 9h14M4 15h14" />);
}
export function DmBubbleIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M4 5h16v10H9l-5 4V5z" />);
}
export function PaperclipIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7-7l7.5-7.5" />);
}
export function PlayIcon({ size = 22, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none" />);
}
export function ChevronDownIcon({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M6 9l6 6 6-6" />);
}
// #endregion
