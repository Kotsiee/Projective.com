/**
 * Global-navigation megamenu taxonomy — the discovery "idea board" behind the four public nav
 * pillars (Helpers · Services · Projects · Products). Each leaf is a canonical deep-link into
 * `/explore`, pre-filling the category scope + a human search term so a hover is a one-click jump
 * into a live, filtered results page. ELI5-friendly copy per PRODUCT_SPEC voice guidelines — plain
 * words over jargon ("People ready to jump in", never "resource pool").
 *
 * Single source for BOTH surfaces: the desktop glass megamenus and the mobile drawer accordions read
 * this same structure, so the taxonomy never drifts between breakpoints.
 */

// #region Types
/** A single leaf link — a pre-filled `/explore` deep-link with friendly display copy. */
export interface MegaLink {
	label: string;
	href: string;
}

/** A logical grouping of leaf links within a pillar (a megamenu column / accordion sub-group). */
export interface MegaColumn {
	heading: string;
	links: MegaLink[];
}

/** One top-level nav pillar: a hover trigger word plus its grouped discovery links. */
export interface MegaMenu {
	/** Stable key — drives signal state, DOM ids, and ARIA wiring. */
	key: string;
	/** Trigger word shown in the nav row. */
	label: string;
	/** One-line ELI5 intro shown above the columns. */
	tagline: string;
	/** Grouped discovery links (rendered as columns on desktop, sub-groups on mobile). */
	columns: MegaColumn[];
	/** The prominent "browse everything" action at the foot of the panel. */
	viewAll: MegaLink;
}
// #endregion

// #region Href builder
/**
 * Build a canonical `/explore` deep-link. Mirrors {@link parseExploreParams}'s contract: `category`
 * is dropped when it is the neutral `all`, and a free-text `q` term is URL-encoded. Kept local (no
 * cross-feature import) so the marketing surface stays decoupled from the explore feature internals.
 */
export function explorePath(category: string, q?: string): string {
	const sp = new URLSearchParams();
	if (category && category !== "all") sp.set("category", category);
	if (q) sp.set("q", q);
	const qs = sp.toString();
	return qs ? `/explore?${qs}` : "/explore";
}

/** Compact leaf-link constructor — `link(category, searchTerm, displayLabel)`. */
function link(category: string, q: string, label: string): MegaLink {
	return { label, href: explorePath(category, q) };
}
// #endregion

// #region Taxonomy
/**
 * The four public discovery pillars, in product-approved order. "Helpers" maps to the `freelancers`
 * scope (which spans both solo freelancers and assembled teams); the other three map 1:1 onto their
 * `/explore` category tokens.
 */
export const MEGA_MENUS: MegaMenu[] = [
	{
		key: "helpers",
		label: "Helpers",
		tagline: "Talented people and teams ready to jump in on your work.",
		columns: [
			{
				heading: "Design & Creative",
				links: [
					link("freelancers", "UI UX Designer", "UI/UX Designers"),
					link("freelancers", "Brand Strategist", "Brand Strategists"),
					link("freelancers", "Illustrator", "Illustrators"),
					link("freelancers", "Video Editor", "Video & Motion Editors"),
				],
			},
			{
				heading: "Development & Tech",
				links: [
					link("freelancers", "Full-Stack Developer", "Full-Stack Devs"),
					link("freelancers", "Mobile Developer", "Mobile App Makers"),
					link("freelancers", "WebGL Engineer", "3D & WebGL Engineers"),
					link("freelancers", "QA Engineer", "QA & Code Reviewers"),
				],
			},
			{
				heading: "Writing & Marketing",
				links: [
					link("freelancers", "Copywriter", "Copywriters"),
					link("freelancers", "SEO Specialist", "SEO Specialists"),
					link("freelancers", "Social Media Manager", "Social Media Managers"),
					link("freelancers", "Content Strategist", "Content Strategists"),
				],
			},
		],
		viewAll: { label: "Browse all helpers", href: explorePath("freelancers") },
	},
	{
		key: "services",
		label: "Services",
		tagline: "Ready-made packages — pick one and get going in minutes.",
		columns: [
			{
				heading: "Design & Brand",
				links: [
					link("services", "Brand Identity", "Brand Identity Design"),
					link("services", "Design System", "Design-System Foundations"),
					link("services", "Landing Page", "Landing Page in a Week"),
					link("services", "Pitch Deck", "Pitch Deck Design"),
				],
			},
			{
				heading: "Build & Ship",
				links: [
					link("services", "MVP Build", "MVP App Builds"),
					link("services", "Website Development", "Website Development"),
					link("services", "E-commerce", "E-commerce Setup"),
					link("services", "API Integration", "API & Integrations"),
				],
			},
			{
				heading: "Grow & Optimise",
				links: [
					link("services", "SEO", "SEO Optimisation"),
					link("services", "Code Audit", "Code Audits"),
					link("services", "Content Engine", "Content Engine Setup"),
					link("services", "Conversion Optimisation", "Conversion Tune-ups"),
				],
			},
		],
		viewAll: { label: "Browse all services", href: explorePath("services") },
	},
	{
		key: "projects",
		label: "Projects",
		tagline: "Post what you need and let the right people come to you.",
		columns: [
			{
				heading: "Design help",
				links: [
					link("projects", "logo design", "Need a Logo"),
					link("projects", "website design", "Need a Website Design"),
					link("projects", "rebrand", "Rebrand My Business"),
					link("projects", "app design", "Design My App"),
				],
			},
			{
				heading: "Build help",
				links: [
					link("projects", "MVP", "Build My MVP"),
					link("projects", "e-commerce", "E-commerce Setup"),
					link("projects", "custom script", "Custom Scripts"),
					link("projects", "website fixes", "Fix / Improve My Site"),
				],
			},
			{
				heading: "Content & Growth",
				links: [
					link("projects", "copywriting", "Write My Copy"),
					link("projects", "SEO", "Grow My SEO"),
					link("projects", "marketing campaign", "Launch a Campaign"),
					link("projects", "video editing", "Edit My Video"),
				],
			},
		],
		viewAll: { label: "Browse all open projects", href: explorePath("projects") },
	},
	{
		key: "products",
		label: "Products",
		tagline: "Instant digital downloads to kickstart your next build.",
		columns: [
			{
				heading: "Design assets",
				links: [
					link("products", "UI kit", "UI Kits & Systems"),
					link("products", "Framer template", "Framer Templates"),
					link("products", "icon set", "Icon Sets"),
					link("products", "illustration pack", "Illustration Packs"),
				],
			},
			{
				heading: "Dev resources",
				links: [
					link("products", "boilerplate", "Developer Boilerplates"),
					link("products", "component library", "Component Libraries"),
					link("products", "code snippets", "Scripts & Snippets"),
					link("products", "API starter", "API Starters"),
				],
			},
			{
				heading: "Productivity",
				links: [
					link("products", "Notion template", "Notion Workspaces"),
					link("products", "Lightroom preset", "Lightroom & Presets"),
					link("products", "font", "Fonts & Type"),
					link("products", "3D scene", "3D Scenes"),
				],
			},
		],
		viewAll: { label: "Browse all products", href: explorePath("products") },
	},
];

/**
 * Secondary utility links retained on the mobile drawer only (removed from the top-level desktop nav
 * in favour of the discovery pillars, but still reachable on small screens).
 */
export const SECONDARY_LINKS: MegaLink[] = [
	{ label: "How it works", href: "/#how-it-works" },
	{ label: "Pricing", href: "/help" },
];
// #endregion
