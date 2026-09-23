/**
 * Marketing landing — the showcase shapes and the one mapper that fills them.
 *
 * The public landing surface is a shop window onto the LIVE marketplace. Its carousels, open-projects
 * grid and products masonry render the same published rows `/explore` renders, resolved server-side by
 * `ExploreBackendService.landing()` and folded into these presentation shapes by
 * {@link landingShowcase}. Nothing here is authored content: a section with nothing published behind it
 * is empty, and the page hides it.
 *
 * Each record carries the canonical deep-link to its live surface via the {@link routes} builders, so a
 * card is a direct route action (DESIGN_SYSTEM.md card logic).
 */

import type {
	ExploreOwner,
	HomeFeed,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
} from "@features/explore/types/explore-types.ts";
import { freelancerFloor } from "@features/explore/core/pricing.ts";

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
 * Canonical public deep-links. Handles carry the pervasive `@` identifier and resolve under the
 * `[handle]` wildcard namespace (root CLAUDE.md §4, Resolved Decision #3). A project links to its
 * PUBLIC view: `/projects/…` is the signed-in workspace, and a visitor sent there is bounced to sign in.
 */
export const routes = {
	profile: (handle: string): string => `/${handle}`,
	project: (slug: string): string => `/view/${slug}?type=projects`,
	product: (slug: string): string => `/view/${slug}`,
} as const;
// #endregion

// #region Types
/** What is known about a picture before it loads: its BlurHash and average colour. */
type Placeholder = ServiceItem["mediaPlaceholder"];

/** Whether a profile card represents a solo freelancer or an assembled micro-agency team. */
export type ProfileKind = "freelancer" | "team";

/** A discovery card for a freelancer or a team (PROFILES CAROUSEL). */
export interface ProfileShowcase {
	handle: string;
	name: string;
	kind: ProfileKind;
	/** One-line specialism — the profile's own headline. */
	craft: string;
	avatar: string;
	avatarPlaceholder?: Placeholder;
	/** Full-bleed cover photograph behind the card head; `""` when the profile has no banner. */
	cover: string;
	coverPlaceholder?: Placeholder;
	/** Delivery reputation from real reviews, or `null` when nobody has reviewed them yet. */
	rating: { value: number; count: number } | null;
	verified: boolean;
	/** Delivered stages — social proof of delivery. */
	delivered: number;
	/** The cheapest active service, pre-formatted (`from $90`); `""` when they list none. */
	rate: string;
	skills: string[];
	/** For teams: member headcount; omitted for solo freelancers. */
	members?: number;
}

/** A fixed-price, actionable service offering (SERVICES CAROUSEL). */
export interface ServiceShowcase {
	slug: string;
	title: string;
	/** Who sells it — the same attribution the discovery card renders. */
	owner: ExploreOwner;
	/** Pre-formatted headline price, e.g. "$1,200". */
	price: string;
	/** Turnaround copy, e.g. "5-day delivery". */
	delivery: string;
	thumb: string;
	thumbPlaceholder?: Placeholder;
	category: string;
}

/** An open project accepting applications (OPEN PROJECTS GRID). */
export interface ProjectShowcase {
	slug: string;
	title: string;
	org: string;
	/** The current stage and its position in the plan, e.g. "UX and flows · Step 2"; `""` if unstaged. */
	stage: string;
	/** The project's stated budget, pre-formatted; `""` when it states none. */
	budget: string;
	/** Roles the project is hiring for. */
	roles: string[];
	/** How far through its stage plan the project is, 0–100. */
	progress: number;
	/** The client's banner; `""` when there is none. */
	thumb: string;
}

/** A ready-to-buy digital product (DIGITAL PRODUCTS MASONRY). */
export interface ProductShowcase {
	slug: string;
	title: string;
	/** Who sells it — the same attribution the discovery card renders. */
	owner: ExploreOwner;
	price: string;
	category: string;
	thumb: string;
	thumbPlaceholder?: Placeholder;
	/** What the cover MEASURED, when the upload recorded it — the tile's ratio follows the picture. */
	mediaMeta?: ProductItem["mediaMeta"];
	/** Masonry cell weight — drives the staggered column rhythm (1 = short, 3 = tall). */
	span: 1 | 2 | 3;
}

/** The four showcase sections, as the landing page renders them. */
export interface LandingShowcase {
	profiles: ProfileShowcase[];
	services: ServiceShowcase[];
	projects: ProjectShowcase[];
	products: ProductShowcase[];
}
// #endregion

// #region Mapping
/** How many cards each section carries — enough to fill its layout, never the whole catalogue. */
const SHOWCASE_LIMIT = { profiles: 8, services: 8, projects: 6, products: 8 } as const;

function profileShowcase(p: ProfileItem): ProfileShowcase {
	return {
		handle: p.owner.handle,
		name: p.title,
		kind: p.type === "teams" ? "team" : "freelancer",
		craft: p.craft,
		avatar: p.owner.avatar,
		avatarPlaceholder: p.owner.avatarPlaceholder,
		cover: p.cover,
		coverPlaceholder: p.coverPlaceholder,
		rating: p.rating?.asHelper
			? { value: p.rating.asHelper.value, count: p.rating.asHelper.count }
			: null,
		verified: p.owner.verified ?? false,
		delivered: p.delivered,
		rate: freelancerFloor(p) ?? "",
		skills: p.skills.map((s) => s.label),
		members: p.type === "teams" ? p.members : undefined,
	};
}

function serviceShowcase(s: ServiceItem): ServiceShowcase {
	return {
		slug: s.id,
		title: s.title,
		owner: s.owner,
		price: s.price,
		delivery: s.delivery,
		thumb: s.media ?? "",
		thumbPlaceholder: s.mediaPlaceholder,
		category: s.category,
	};
}

function projectShowcase(p: ProjectItem): ProjectShowcase {
	const index = p.phases.indexOf(p.stage);
	const step = index >= 0 ? index + 1 : 1;
	return {
		slug: p.id,
		title: p.title,
		org: p.org,
		stage: p.stage ? `${p.stage} · Step ${step}` : "",
		budget: p.budget,
		roles: p.roles,
		progress: p.phases.length ? Math.round(((step - 1) / p.phases.length) * 100) : 0,
		thumb: p.cover ?? "",
	};
}

function productShowcase(p: ProductItem): ProductShowcase {
	return {
		slug: p.id,
		title: p.title,
		owner: p.owner,
		price: p.price,
		category: p.category,
		thumb: p.media ?? "",
		thumbPlaceholder: p.mediaPlaceholder,
		mediaMeta: p.mediaMeta,
		span: p.span,
	};
}

/**
 * Fold the live home feed into the landing's four showcase sections. Every list is the
 * recommended ranking (the same comparator `/explore`'s default sort uses), so the landing and the
 * discovery page put the same work forward.
 */
export function landingShowcase(home: HomeFeed): LandingShowcase {
	return {
		profiles: home.recommended.people.slice(0, SHOWCASE_LIMIT.profiles).map(profileShowcase),
		services: home.recommended.services.slice(0, SHOWCASE_LIMIT.services).map(serviceShowcase),
		projects: home.recommended.projects.slice(0, SHOWCASE_LIMIT.projects).map(projectShowcase),
		products: home.recommended.products.slice(0, SHOWCASE_LIMIT.products).map(productShowcase),
	};
}
// #endregion
