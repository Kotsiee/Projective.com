/**
 * Marketing landing — static showcase data.
 *
 * The public landing surface is a shop window, not an authenticated feed. These curated fixtures
 * feed the profile/service carousels, the open-projects grid, and the digital-products masonry. Each
 * record carries the canonical deep-link to its live surface via the {@link routes} builders, so a
 * card is a direct route action (DESIGN_SYSTEM.md card logic). Swap for real Service queries once the
 * discovery API lands; the shapes below are intentionally close to their Zod-validated counterparts.
 */

// #region Search
/**
 * The canonical search scopes offered by the hero, header, and `/explore` search selectors. Single
 * source so every search surface stays in lockstep. Each scope carries the `/explore?category=` token
 * it navigates to (`all` is the neutral default — no category filter). "Freelancers" (the
 * service-providing identities) and "People" (individual members) are deliberately distinct scopes.
 * Order is the product-approved order.
 */
export const SEARCH_SCOPES = [
	{ value: "all", label: "All" },
	{ value: "freelancers", label: "Freelancers & Teams" },
	{ value: "users", label: "People & Businesses" },
	{ value: "services", label: "Services" },
	{ value: "products", label: "Products" },
	{ value: "projects", label: "Projects" },
	{ value: "articles", label: "Articles" },
] as const;

/** A search-scope token (the `/explore?category=` value each selector option navigates to). */
export type SearchScope = typeof SEARCH_SCOPES[number]["value"];

/** The default resting scope for every search selector — the neutral "All". */
export const DEFAULT_SEARCH_SCOPE: SearchScope = "all";

/** Resolve a scope token to its human label (unknown → the default scope's label). */
export function searchScopeLabel(value: string): string {
	return SEARCH_SCOPES.find((s) => s.value === value)?.label ??
		SEARCH_SCOPES.find((s) => s.value === DEFAULT_SEARCH_SCOPE)!.label;
}
// #endregion

// #region Route builders
/**
 * Canonical public deep-links. Centralised so the card wiring stays declarative and the eventual
 * move to real slugs/handles is a single-file change. Handles carry the pervasive `@` identifier and
 * resolve under the `[handle]` wildcard namespace (root CLAUDE.md §4, Resolved Decision #3).
 */
export const routes = {
	profile: (handle: string): string => `/${handle}`,
	service: (slug: string): string => `/services/${slug}`,
	project: (slug: string): string => `/projects/${slug}`,
	product: (slug: string): string => `/view/${slug}`,
} as const;
// #endregion

// #region Media
/**
 * Unsplash source builder. Fixed transform params keep every thumbnail crisp, format-negotiated, and
 * bandwidth-light; a solid `--surface` tint sits behind each image so a slow/blocked load degrades to
 * a calm panel rather than a void.
 */
export function unsplash(id: string, w = 900, h = 1100): string {
	return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&h=${h}&q=72`;
}
// #endregion

// #region Types
/** Whether a profile card represents a solo freelancer or an assembled micro-agency team. */
export type ProfileKind = "freelancer" | "team";

/** A discovery card for a freelancer or a team (PROFILES CAROUSEL). */
export interface ProfileShowcase {
	handle: string;
	name: string;
	kind: ProfileKind;
	/** One-line specialism, e.g. "Brand & Motion". */
	craft: string;
	avatar: string;
	/** Full-bleed cover photograph behind the card head. */
	cover: string;
	/** 0–5, one decimal. */
	rating: number;
	/** Completed stage count — social proof of delivery. */
	delivered: number;
	/** Indicative day-rate (freelancer) or starting engagement (team), pre-formatted. */
	rate: string;
	skills: string[];
	/** For teams: member headcount; omitted for solo freelancers. */
	members?: number;
}

/** A fixed-price, actionable service offering (SERVICES CAROUSEL). */
export interface ServiceShowcase {
	slug: string;
	title: string;
	providerHandle: string;
	provider: string;
	/** Pre-formatted fixed price, e.g. "$1,200". */
	price: string;
	/** Turnaround copy, e.g. "5-day delivery". */
	delivery: string;
	thumb: string;
	category: string;
}

/** An open pipeline accepting applications (OPEN PROJECTS GRID). */
export interface ProjectShowcase {
	slug: string;
	title: string;
	org: string;
	/** Current lifecycle stage label (PRODUCT_MANAGEMENT status vocabulary). */
	stage: string;
	/** Escrow-funded budget, pre-formatted. */
	budget: string;
	/** Roles the project is hiring for. */
	roles: string[];
	/** Delivery progress 0–100 across the staged plan. */
	progress: number;
	thumb: string;
}

/** A ready-to-buy digital product (DIGITAL PRODUCTS MASONRY). */
export interface ProductShowcase {
	slug: string;
	title: string;
	makerHandle: string;
	maker: string;
	price: string;
	category: string;
	thumb: string;
	/** Masonry cell weight — drives the staggered column rhythm (1 = short, 3 = tall). */
	span: 1 | 2 | 3;
}
// #endregion

// #region Fixtures
export const PROFILES: ProfileShowcase[] = [
	{
		handle: "@ateliernova",
		name: "Atelier Nova",
		kind: "team",
		craft: "Brand systems & motion",
		avatar: unsplash("1600880292203-757bb62b4baf", 200, 200),
		cover: unsplash("1618005182384-a83a8bd57fbe", 900, 700),
		rating: 4.9,
		delivered: 142,
		rate: "from $6.5k",
		skills: ["Identity", "Motion", "Webflow"],
		members: 5,
	},
	{
		handle: "@marisdelacroix",
		name: "Maris Delacroix",
		kind: "freelancer",
		craft: "Product design lead",
		avatar: unsplash("1494790108377-be9c29b29330", 200, 200),
		cover: unsplash("1558655146-9f40138edfeb", 900, 700),
		rating: 5.0,
		delivered: 68,
		rate: "$140/hr",
		skills: ["UX", "Design systems", "Figma"],
	},
	{
		handle: "@northloop",
		name: "North Loop",
		kind: "team",
		craft: "Full-stack product studio",
		avatar: unsplash("1633356122544-f134324a6cee", 200, 200),
		cover: unsplash("1461749280684-dccba630e2f6", 900, 700),
		rating: 4.8,
		delivered: 203,
		rate: "from $12k",
		skills: ["Deno", "Postgres", "Realtime"],
		members: 8,
	},
	{
		handle: "@renkoda",
		name: "Ren Koda",
		kind: "freelancer",
		craft: "3D & spatial interfaces",
		avatar: unsplash("1507003211169-0a1dd7228f2d", 200, 200),
		cover: unsplash("1633356122544-f134324a6cee", 900, 700),
		rating: 4.9,
		delivered: 51,
		rate: "$120/hr",
		skills: ["WebGL", "Blender", "Three.js"],
	},
	{
		handle: "@studiofern",
		name: "Studio Fern",
		kind: "team",
		craft: "Editorial & content ops",
		avatar: unsplash("1573496359142-b8d87734a5a2", 200, 200),
		cover: unsplash("1499750310107-5fef28a66643", 900, 700),
		rating: 4.7,
		delivered: 96,
		rate: "from $4k",
		skills: ["Strategy", "Copy", "SEO"],
		members: 4,
	},
	{
		handle: "@juno",
		name: "Juno Park",
		kind: "freelancer",
		craft: "Frontend engineering",
		avatar: unsplash("1519085360753-af0119f7cbe7", 200, 200),
		cover: unsplash("1487014679447-9f8336841d58", 900, 700),
		rating: 5.0,
		delivered: 77,
		rate: "$135/hr",
		skills: ["Preact", "Signals", "A11y"],
	},
];

export const SERVICES: ServiceShowcase[] = [
	{
		slug: "brand-identity-sprint",
		title: "Brand identity sprint",
		providerHandle: "@ateliernova",
		provider: "Atelier Nova",
		price: "$4,800",
		delivery: "10-day delivery",
		thumb: unsplash("1626785774573-4b799315345d", 800, 600),
		category: "Branding",
	},
	{
		slug: "design-system-foundation",
		title: "Design-system foundation",
		providerHandle: "@marisdelacroix",
		provider: "Maris Delacroix",
		price: "$3,200",
		delivery: "2-week delivery",
		thumb: unsplash("1545235617-9465d2a55698", 800, 600),
		category: "Product",
	},
	{
		slug: "landing-page-in-a-week",
		title: "Landing page in a week",
		providerHandle: "@juno",
		provider: "Juno Park",
		price: "$2,400",
		delivery: "5-day delivery",
		thumb: unsplash("1467232004584-a241de8bcf5d", 800, 600),
		category: "Web",
	},
	{
		slug: "realtime-mvp-build",
		title: "Realtime MVP build",
		providerHandle: "@northloop",
		provider: "North Loop",
		price: "$9,500",
		delivery: "4-week delivery",
		thumb: unsplash("1518432031352-d6fc5c10da5a", 800, 600),
		category: "Engineering",
	},
	{
		slug: "product-launch-film",
		title: "Product launch film",
		providerHandle: "@renkoda",
		provider: "Ren Koda",
		price: "$6,100",
		delivery: "3-week delivery",
		thumb: unsplash("1536240478700-b869070f9279", 800, 600),
		category: "Motion",
	},
	{
		slug: "content-engine-setup",
		title: "Content engine setup",
		providerHandle: "@studiofern",
		provider: "Studio Fern",
		price: "$3,900",
		delivery: "2-week delivery",
		thumb: unsplash("1499750310107-5fef28a66643", 800, 600),
		category: "Content",
	},
];

export const PROJECTS: ProjectShowcase[] = [
	{
		slug: "helia-wallet-redesign",
		title: "Helia wallet redesign",
		org: "Helia Finance",
		stage: "Hiring · Step 1",
		budget: "$48,000 held safe",
		roles: ["Product designer", "Frontend", "Motion"],
		progress: 12,
		thumb: unsplash("1551288049-bebda4e38f71", 800, 600),
	},
	{
		slug: "atlas-analytics-platform",
		title: "Atlas analytics platform",
		org: "Atlas Labs",
		stage: "In progress · Step 3",
		budget: "$120,000 held safe",
		roles: ["Full-stack", "Data viz"],
		progress: 54,
		thumb: unsplash("1551288259-cd19f3a1534e", 800, 600),
	},
	{
		slug: "verdant-brand-refresh",
		title: "Verdant brand refresh",
		org: "Verdant",
		stage: "Hiring · Step 1",
		budget: "$32,000 held safe",
		roles: ["Brand lead", "Illustration"],
		progress: 8,
		thumb: unsplash("1524758631624-e2822e304c36", 800, 600),
	},
	{
		slug: "loop-mobile-app",
		title: "Loop mobile app",
		org: "Loop",
		stage: "Planning · Step 0",
		budget: "$76,000 held safe",
		roles: ["iOS", "Android", "Design"],
		progress: 3,
		thumb: unsplash("1512941937669-90a1b58e7e9c", 800, 600),
	},
	{
		slug: "meridian-design-system",
		title: "Meridian design system",
		org: "Meridian",
		stage: "In progress · Step 2",
		budget: "$54,000 held safe",
		roles: ["Design systems", "Docs"],
		progress: 41,
		thumb: unsplash("1531403009284-440f080d1e12", 800, 600),
	},
	{
		slug: "cove-commerce-migration",
		title: "Cove commerce migration",
		org: "Cove",
		stage: "Hiring · Step 1",
		budget: "$88,000 held safe",
		roles: ["Backend", "DevOps"],
		progress: 18,
		thumb: unsplash("1556742049-0cfed4f6a45d", 800, 600),
	},
];

export const PRODUCTS: ProductShowcase[] = [
	{
		slug: "aurora-ui-kit",
		title: "Aurora UI kit",
		makerHandle: "@ateliernova",
		maker: "Atelier Nova",
		price: "$79",
		category: "UI kit",
		thumb: unsplash("1620641788421-7a1c342ea42e", 800, 1000),
		span: 3,
	},
	{
		slug: "grain-lightroom-pack",
		title: "Grain — Lightroom pack",
		makerHandle: "@renkoda",
		maker: "Ren Koda",
		price: "$24",
		category: "Presets",
		thumb: unsplash("1502920917128-1aa500764cbd", 800, 600),
		span: 1,
	},
	{
		slug: "motion-primitives",
		title: "Motion primitives",
		makerHandle: "@juno",
		maker: "Juno Park",
		price: "$49",
		category: "Code",
		thumb: unsplash("1550745165-9bc0b252726f", 800, 800),
		span: 2,
	},
	{
		slug: "editorial-type-system",
		title: "Editorial type system",
		makerHandle: "@studiofern",
		maker: "Studio Fern",
		price: "$120",
		category: "Fonts",
		thumb: unsplash("1455390582262-044cdead277a", 800, 1000),
		span: 3,
	},
	{
		slug: "dashboard-blocks",
		title: "Dashboard blocks",
		makerHandle: "@northloop",
		maker: "North Loop",
		price: "$65",
		category: "Templates",
		thumb: unsplash("1551288049-bebda4e38f71", 800, 700),
		span: 2,
	},
	{
		slug: "iconography-set",
		title: "Iconography set — 640",
		makerHandle: "@marisdelacroix",
		maker: "Maris Delacroix",
		price: "$38",
		category: "Icons",
		thumb: unsplash("1516131206008-dd041a9764fd", 800, 600),
		span: 1,
	},
	{
		slug: "3d-product-scenes",
		title: "3D product scenes",
		makerHandle: "@renkoda",
		maker: "Ren Koda",
		price: "$95",
		category: "3D",
		thumb: unsplash("1633356122544-f134324a6cee", 800, 900),
		span: 2,
	},
	{
		slug: "notion-ops-suite",
		title: "Notion ops suite",
		makerHandle: "@studiofern",
		maker: "Studio Fern",
		price: "$29",
		category: "Templates",
		thumb: unsplash("1499750310107-5fef28a66643", 800, 600),
		span: 1,
	},
];
// #endregion
