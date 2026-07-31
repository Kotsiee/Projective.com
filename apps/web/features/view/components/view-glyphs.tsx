import type { JSX } from "preact";
import type { TrustFact } from "@projective/types/explore";
import { IconShell } from "@projective/ui/icons";

/**
 * view-glyphs — the Entity View page's inline SVG glyph set (24×24 line icons, `currentColor`,
 * `aria-hidden`), matching the shell/profile glyph idiom. `@projective/ui` is icon-library agnostic, so
 * the app owns its glyphs (packages/ui/CLAUDE.md). Covers the sidebar CTAs, the operational trust
 * chips, and the media gallery / lightbox controls.
 */

export type ViewGlyph =
	| "buy"
	| "basket"
	| "message"
	| "calendar"
	| "check"
	| "expand"
	| "close"
	| "chevron-left"
	| "chevron-right"
	| "chevron-down"
	| "chevron-up"
	| "response"
	| "delivery"
	| "seller"
	| "escrow"
	| "revisions"
	| "returns"
	// Project view — metrics, stage flow, CTAs.
	| "budget"
	| "stages"
	| "seats"
	| "type"
	| "timeline"
	| "roles"
	| "ticket"
	| "skill"
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
	| "clock"
	| "arrow-up-right";

const P: Record<ViewGlyph, JSX.Element> = {
	buy: (
		<path d="M6 6h15l-1.5 9h-12L6 3H3M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z" />
	),
	basket: <path d="M5 8h14l-1 11a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8zm3 0a4 4 0 018 0" />,
	message: <path d="M4 5h16v11H9l-4 3v-3H4z" />,
	calendar: (
		<path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 10h16M8 3v4M16 3v4" />
	),
	check: <path d="M4 12l5 5L20 6" />,
	expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
	close: <path d="M6 6l12 12M18 6L6 18" />,
	"chevron-left": <path d="M15 5l-7 7 7 7" />,
	"chevron-right": <path d="M9 5l7 7-7 7" />,
	response: <path d="M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" />,
	delivery: (
		<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm10 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
	),
	seller: <path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.6 9.1l5.8-.8z" />,
	escrow: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4" />,
	revisions: (
		<path d="M4 12a8 8 0 018-8 8 8 0 016.9 4M20 4v4h-4M20 12a8 8 0 01-8 8 8 8 0 01-6.9-4M4 20v-4h4" />
	),
	returns: <path d="M9 5L4 10l5 5M4 10h11a5 5 0 010 10h-3" />,
	"chevron-down": <path d="M6 9l6 6 6-6" />,
	"chevron-up": <path d="M6 15l6-6 6 6" />,
	budget: (
		<path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M14.5 9.4C14 8.6 13 8 12 8c-1.5 0-2.5.9-2.5 2s1 1.8 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.3" />
	),
	stages: <path d="M4 8l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" />,
	seats: <path d="M6 10V6a2 2 0 012-2h8a2 2 0 012 2v4M5 10h14v6H5zM7 16v3M17 16v3" />,
	type: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
	timeline: <path d="M3 12h18M6 9v6M12 9v6M18 9v6" />,
	roles: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />,
	ticket: (
		<path d="M4 8a2 2 0 012-2h12a2 2 0 012 2 2 2 0 000 4 2 2 0 010 4H6a2 2 0 01-2-2 2 2 0 000-4zM14 6v12" />
	),
	skill: <path d="M4 4h6l10 10-6 6L4 10V4zM8 8a1 1 0 100-2 1 1 0 000 2z" />,
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
	"arrow-up-right": <path d="M7 17L17 7M8 7h9v9" />,
};

export function ViewIcon(
	{ name, size = 24, ...rest }:
		& { name: ViewGlyph; size?: number }
		& JSX.SVGAttributes<SVGSVGElement>,
): JSX.Element {
	return <IconShell size={size} {...rest}>{P[name]}</IconShell>;
}

/** Map a trust fact's iconographic key to its glyph. */
export function trustIcon(icon: TrustFact["icon"]): JSX.Element {
	return <ViewIcon name={icon} size={18} />;
}
