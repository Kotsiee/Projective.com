import type { JSX } from "preact";
import type { TrustFact } from "@projective/types/explore";

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
	| "check"
	| "expand"
	| "close"
	| "chevron-left"
	| "chevron-right"
	| "response"
	| "delivery"
	| "seller"
	| "escrow"
	| "revisions"
	| "returns";

const P: Record<ViewGlyph, JSX.Element> = {
	buy: (
		<path d="M6 6h15l-1.5 9h-12L6 3H3M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z" />
	),
	basket: <path d="M5 8h14l-1 11a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8zm3 0a4 4 0 018 0" />,
	message: <path d="M4 5h16v11H9l-4 3v-3H4z" />,
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
};

export function ViewIcon(
	{ name, size = 24, ...rest }:
		& { name: ViewGlyph; size?: number }
		& JSX.SVGAttributes<SVGSVGElement>,
): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			stroke-width={1.7}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{P[name]}
		</svg>
	);
}

/** Map a trust fact's iconographic key to its glyph. */
export function trustIcon(icon: TrustFact["icon"]): JSX.Element {
	return <ViewIcon name={icon} size={18} />;
}
