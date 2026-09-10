import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * view-glyphs — the Entity View feature's remaining inline SVG glyph set (24×24 line icons,
 * `currentColor`, `aria-hidden`), matching the shell/profile glyph idiom. `@projective/ui` is
 * icon-library agnostic, so the app owns its glyphs (packages/ui/CLAUDE.md). Covers the article
 * template's body media / comments controls, the media lightbox, and the dashboard's Apply control.
 * The `.evp` frame draws from the shared `@projective/ui/icons` registry instead.
 */

export type ViewGlyph =
	// Media lightbox + the dashboard's Apply control.
	| "calendar"
	| "check"
	| "expand"
	| "close"
	| "chevron-left"
	| "chevron-right"
	| "apply"
	// Article view — body media, TOC, comments.
	| "play"
	| "image"
	| "video"
	| "audio"
	| "list"
	| "comment"
	| "like"
	| "reply"
	| "send"
	| "clock";

const P: Record<ViewGlyph, JSX.Element> = {
	calendar: (
		<path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 10h16M8 3v4M16 3v4" />
	),
	check: <path d="M4 12l5 5L20 6" />,
	expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
	close: <path d="M6 6l12 12M18 6L6 18" />,
	"chevron-left": <path d="M15 5l-7 7 7 7" />,
	"chevron-right": <path d="M9 5l7 7-7 7" />,
	apply: <path d="M12 20V8M6 12l6-6 6 6M5 4h14" />,
	play: <path d="M8 5v14l11-7z" />,
	image: <path d="M4 5h16v14H4zM8 11a2 2 0 100-4 2 2 0 000 4zM4 16l5-4 4 3 3-2 4 3" />,
	video: <path d="M4 6h11v12H4zM15 10l5-3v10l-5-3z" />,
	audio: <path d="M3 10v4M7 6v12M11 3v18M15 8v8M19 10v4" />,
	list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
	comment: <path d="M4 5h16v11H9l-4 3v-3H4zM8 10h.01M12 10h.01M16 10h.01" />,
	like: <path d="M12 20s-7-4.6-9.5-9A4.5 4.5 0 0112 5a4.5 4.5 0 019.5 6c-2.5 4.4-9.5 9-9.5 9z" />,
	reply: <path d="M9 7L4 12l5 5M4 12h9a5 5 0 015 5v1" />,
	send: <path d="M4 12l16-8-6 16-3-7-7-1z" />,
	clock: <path d="M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" />,
};

export function ViewIcon(
	{ name, size = 24, ...rest }:
		& { name: ViewGlyph; size?: number }
		& JSX.SVGAttributes<SVGSVGElement>,
): JSX.Element {
	return <IconShell size={size} {...rest}>{P[name]}</IconShell>;
}
