import type { JSX, VNode } from "preact";
import type { ProfileKind, ProfileTab, VerificationTier } from "../types/profile-types.ts";

/**
 * profile-glyphs — the profile shell's inline SVG glyph set + the tab/tier icon resolvers. Mirrors the
 * shell's `nav-icons.tsx` idiom (24×24 line icons, `currentColor`, `aria-hidden`) so the action lane
 * and tab bar read consistently with the global rail. `@projective/ui` is icon-library agnostic, so the
 * app owns its glyphs (packages/ui/CLAUDE.md).
 */

// #region Glyph names
export type ProfileGlyph =
	| "back"
	| "share"
	| "follow"
	| "following"
	| "hire"
	| "message"
	| "availability"
	| "edit"
	| "settings"
	| "plus"
	| "star"
	| "clock"
	| "location"
	| "verified"
	| "response"
	| "overview"
	| "services"
	| "products"
	| "projects"
	| "portfolio"
	| "education"
	| "experience"
	| "teams"
	| "businesses"
	| "articles"
	| "members"
	| "departments"
	| "reviews"
	| "external"
	| "chevron"
	| "kebab"
	| "link"
	| "flag"
	// Entity-type badge glyphs (Part 1).
	| "entity-freelancer"
	| "entity-client"
	| "entity-team"
	| "entity-business"
	| "entity-organisation";
// #endregion

const PATHS: Record<ProfileGlyph, VNode> = {
	back: <path d="M15 5l-7 7 7 7" />,
	share: (
		<>
			<circle cx="6" cy="12" r="2.5" />
			<circle cx="18" cy="6" r="2.5" />
			<circle cx="18" cy="18" r="2.5" />
			<path d="M8.2 10.8 15.8 7.2M8.2 13.2 15.8 16.8" />
		</>
	),
	follow: (
		<>
			<circle cx="9" cy="8" r="3.5" />
			<path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 8v6M15 11h6" />
		</>
	),
	following: (
		<>
			<circle cx="9" cy="8" r="3.5" />
			<path d="M3.5 20a5.5 5.5 0 0 1 11 0M15.5 11l2 2 3.5-3.5" />
		</>
	),
	hire: (
		<>
			<rect x="3" y="7" width="18" height="12" rx="2" />
			<path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12h18M12 11v2" />
		</>
	),
	message: <path d="M4 5h16v11H9l-4 3v-3H4z" />,
	availability: (
		<>
			<rect x="3.5" y="4.5" width="17" height="16" rx="2" />
			<path d="M3.5 9h17M8 3v3M16 3v3M12 12.5v2.2l1.6 1" />
		</>
	),
	edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
		</>
	),
	plus: <path d="M12 5v14M5 12h14" />,
	star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9z" />,
	clock: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7v5l3.5 2" />
		</>
	),
	location: (
		<>
			<path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" />
			<circle cx="12" cy="10" r="2.5" />
		</>
	),
	verified: (
		<>
			<path d="M12 3l2.1 1.6 2.6-.2 1 2.4 2.2 1.4-.6 2.6.6 2.6-2.2 1.4-1 2.4-2.6-.2L12 21l-2.1-1.6-2.6.2-1-2.4-2.2-1.4.6-2.6-.6-2.6 2.2-1.4 1-2.4 2.6.2z" />
			<path d="M9 12l2 2 4-4" />
		</>
	),
	response: <path d="M13 3 4 14h6l-1 7 9-11h-6z" />,
	overview: (
		<>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 20a8 8 0 0 1 16 0" />
		</>
	),
	services: <path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 8v5m18-5v5" />,
	products: (
		<>
			<path d="M12 3 4 7v10l8 4 8-4V7z" />
			<path d="M4 7l8 4 8-4M12 11v10" />
		</>
	),
	projects: (
		<>
			<path d="M4 21V10a8 8 0 0 1 16 0v11" />
			<path d="M4 21h16" />
			<path d="M9.5 21v-5.5a2.5 2.5 0 0 1 5 0V21" />
		</>
	),
	portfolio: (
		<>
			<rect x="3.5" y="5" width="17" height="14" rx="2" />
			<path d="M3.5 15l4.5-4 3.5 3 3-2.5 6 5.5" />
			<circle cx="8.5" cy="9.5" r="1.4" />
		</>
	),
	education: <path d="M12 4 2.5 9 12 14l7-3.7V16M6 11.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4.5" />,
	experience: (
		<>
			<rect x="3.5" y="7" width="17" height="12" rx="2" />
			<path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3.5 12h17" />
		</>
	),
	teams: (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6m1 8a6 6 0 0 0-3-5" />
		</>
	),
	businesses: (
		<>
			<path d="M4 21V5l8-2v18M12 9h8v12M8 8v0M8 12v0M8 16v0" />
			<path d="M15 13v0M15 17v0" />
		</>
	),
	articles: (
		<>
			<rect x="5" y="3" width="14" height="18" rx="2" />
			<path d="M8 8h8M8 12h8M8 16h5" />
		</>
	),
	members: (
		<>
			<circle cx="8" cy="9" r="2.6" />
			<circle cx="16" cy="9" r="2.6" />
			<path d="M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0" />
		</>
	),
	// Departments / org-chart — a top node branching down to child nodes (sitemap).
	departments: (
		<>
			<rect x="9" y="3.5" width="6" height="4.5" rx="1" />
			<rect x="3.5" y="15.5" width="5" height="4.5" rx="1" />
			<rect x="15.5" y="15.5" width="5" height="4.5" rx="1" />
			<path d="M12 8v3.5M6 15.5V12h12v3.5" />
		</>
	),
	// Reviews — a speech bubble carrying a star (distinct from the tier verified mark).
	reviews: (
		<>
			<path d="M4 5h16v11H9l-4 3v-3H4z" />
			<path d="M12 7.4l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" />
		</>
	),
	external:
	<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
	chevron: <path d="m9 6 6 6-6 6" />,
	kebab: (
		<>
			<circle cx="12" cy="5" r="1.5" />
			<circle cx="12" cy="12" r="1.5" />
			<circle cx="12" cy="19" r="1.5" />
		</>
	),
	link: (
		<path d="M9 15l6-6M10.5 6.5l1.8-1.8a3.5 3.5 0 0 1 5 5l-2.3 2.3M13.5 17.5l-1.8 1.8a3.5 3.5 0 0 1-5-5l2.3-2.3" />
	),
	flag: <path d="M5 21V4M5 4h11l-2 3.5L16 11H5" />,
	// Entity-type glyphs (Part 1) — one distinct mark per profile kind.
	"entity-freelancer": (
		<>
			<circle cx="12" cy="8" r="3.5" />
			<path d="M5 20a7 7 0 0 1 14 0" />
		</>
	),
	"entity-client": (
		<>
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="10" r="2.6" />
			<path d="M7 17.5a5 5 0 0 1 10 0" />
		</>
	),
	"entity-team": (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6m1 8a6 6 0 0 0-3-5" />
		</>
	),
	"entity-business": (
		<>
			<path d="M4 21V5l8-2v18" />
			<path d="M12 9h8v12H4" />
			<path d="M8 8v0M8 12v0M8 16v0M15 13v0M15 17v0" />
		</>
	),
	"entity-organisation": (
		<>
			<rect x="9" y="3.5" width="6" height="4.5" rx="1" />
			<rect x="3.5" y="15.5" width="5" height="4.5" rx="1" />
			<rect x="15.5" y="15.5" width="5" height="4.5" rx="1" />
			<path d="M12 8v3.5M6 15.5V12h12v3.5" />
		</>
	),
};

/**
 * ProfileIcon — renders a profile glyph by name. Stroke-based, `currentColor`, `aria-hidden` (labels
 * carry the accessible name). Extra SVG props (e.g. `class`) are forwarded to the root `<svg>`.
 */
export function ProfileIcon(
	{ name, ...svg }: { name: ProfileGlyph } & JSX.SVGAttributes<SVGSVGElement>,
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

/** The glyph name for a profile tab. Most tab names map 1:1 to a glyph; a few are aliased. */
export function tabGlyph(tab: ProfileTab): ProfileGlyph {
	switch (tab) {
		case "about":
			return "overview";
		default:
			return tab as ProfileGlyph;
	}
}

/** The tab icon VNode. */
export function tabIcon(tab: ProfileTab): VNode {
	return <ProfileIcon name={tabGlyph(tab)} />;
}

// #region Entity-type badge (Part 1)
/** Presentation metadata for a profile's entity type — a distinct label + glyph per {@link ProfileKind}. */
export const ENTITY_META: Record<ProfileKind, { label: string; glyph: ProfileGlyph }> = {
	freelancer: { label: "Freelancer", glyph: "entity-freelancer" },
	client: { label: "Client", glyph: "entity-client" },
	team: { label: "Team", glyph: "entity-team" },
	business: { label: "Business", glyph: "entity-business" },
	organisation: { label: "Organisation", glyph: "entity-organisation" },
};
// #endregion

// #region Verification tiers
/** Presentation metadata for a verification tier (badge label + full title). */
export const TIER_META: Record<VerificationTier, { label: string; title: string }> = {
	L1: { label: "L1", title: "L1 · Basic — email & identity confirmed" },
	L2: { label: "L2", title: "L2 · Verified — ID & payment verified" },
	L3: { label: "L3", title: "L3 · Business / KYB verified" },
	architect: { label: "Architect", title: "Architect Tier — top-trust operator" },
};
// #endregion
