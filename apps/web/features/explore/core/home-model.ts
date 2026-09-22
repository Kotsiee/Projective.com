import { serializeExploreParams } from "./explore-state.ts";
import { filterHref } from "./routing.ts";
import { DEFAULT_SORT } from "./explore-state.ts";

/**
 * Explore Home — the pure configuration behind the above-the-fold chrome and the body's section rail.
 *
 * Everything here is a projection over URL vocabulary the app already owns: no fetching, no clock, no
 * DOM. It lives outside the components so the chip bar, the Recommended toggles and the section
 * headings cannot drift from each other or from what `/explore` will actually parse when the reader
 * arrives there — a chip that reads "Sessions" and lands on the unfiltered feed is worse than no chip.
 */

// #region Category chips
/** One chip in the horizontal category bar above the Recommended panel. */
export interface CategoryChip {
	/** Stable key — also the `data-chip` hook, and what a consumer marks active on. */
	id: string;
	label: string;
	href: string;
}

/**
 * The chip bar's vocabulary.
 *
 * It is deliberately LONGER than the four the design calls out (Freelancers · Products · Services ·
 * Sessions). The bar is built as an overflow scroller with edge affordances and paging arrows, and an
 * affordance for content that never overflows is a control that does nothing — so the bar carries the
 * entities that lost a dedicated Home section in this layout (Teams, Businesses, People) rather than
 * leaving them reachable only from the footer.
 *
 * **Sessions is the one chip that is not a category.** "Session" and "Group Session" are `ServiceType`
 * values on a service item, not members of `ExploreCategory` — so it cannot be built with
 * {@link filterHref}, whose signature is `{q, category}` and which would silently coerce an unknown
 * token to `all` and land the reader on the unfiltered feed. It is built with
 * {@link serializeExploreParams} instead, which emits arbitrary facets, against the `model` facet the
 * services filter group and the backend query both understand. Both session models are selected: a
 * reader asking for "sessions" means live time with a person, and the 1:1 / cohort distinction is a
 * choice they make after they can see both.
 */
export const CATEGORY_CHIPS: CategoryChip[] = [
	{ id: "freelancers", label: "Freelancers", href: filterHref({ category: "freelancers" }) },
	{ id: "services", label: "Services", href: filterHref({ category: "services" }) },
	{ id: "products", label: "Products", href: filterHref({ category: "products" }) },
	{
		id: "sessions",
		label: "Sessions",
		href: serializeExploreParams({
			q: "",
			category: "services",
			sort: DEFAULT_SORT,
			filters: { model: ["Session", "Group Session"] },
		}),
	},
	{ id: "projects", label: "Projects", href: filterHref({ category: "projects" }) },
	{ id: "teams", label: "Teams", href: filterHref({ category: "teams" }) },
	{ id: "businesses", label: "Businesses", href: filterHref({ category: "businesses" }) },
	{ id: "users", label: "People", href: filterHref({ category: "users" }) },
	{ id: "articles", label: "Articles", href: filterHref({ category: "articles" }) },
];
// #endregion

// #region Recommended panel
/** The four toggles in the Recommended panel's left column. */
export type RecommendedTab = "services" | "products" | "projects" | "people";

/** One toggle: its key, its visible label, and where "see everything of this" leads. */
export interface RecommendedTabDef {
	id: RecommendedTab;
	label: string;
	href: string;
}

export const RECOMMENDED_TABS: RecommendedTabDef[] = [
	{ id: "services", label: "Services", href: filterHref({ category: "services" }) },
	{ id: "products", label: "Products", href: filterHref({ category: "products" }) },
	{ id: "projects", label: "Projects", href: filterHref({ category: "projects" }) },
	{ id: "people", label: "People", href: filterHref({ category: "freelancers" }) },
];

/** The toggle that is open on first paint — services, the marketplace's primary purchasable. */
export const DEFAULT_RECOMMENDED_TAB: RecommendedTab = "services";
// #endregion

// #region Quick filters
/** A hero pill: a one-tap jump into a pre-filtered search, under the search field. */
export interface QuickFilter {
	label: string;
	href: string;
}

/**
 * The quick-filter pills under the hero search field.
 *
 * These are INTENT shortcuts, deliberately not a second copy of the category chips directly beneath
 * them: the chip bar answers "what kind of thing", these answer "what am I here to do". Each one is a
 * real query the corpus can satisfy, so none of them lands on an empty results page.
 */
export const HERO_QUICK_FILTERS: QuickFilter[] = [
	{ label: "Hire a freelancer", href: filterHref({ category: "freelancers" }) },
	{ label: "Buy a service", href: filterHref({ category: "services" }) },
	{ label: "Join a project", href: filterHref({ category: "projects" }) },
	{ label: "Download a product", href: filterHref({ category: "products" }) },
	{ label: "Read a guide", href: filterHref({ category: "articles" }) },
];
// #endregion

// #region Body sections
/**
 * One body section's heading contract: a bold-italic lead word, a regular muted tail, and the
 * "see all" destination.
 *
 * The split is a real typographic contract rather than one string with markup in it, because the two
 * halves are set in different weights AND different styles and a section that inlined its own `<em>`
 * would be free to disagree with its neighbour about which half is which.
 */
export interface HomeSectionDef {
	id: string;
	/** The bold-italic half — the category. */
	lead: string;
	/** The regular muted half — what the reader gets from it. */
	tail: string;
	href: string;
}

export const HOME_SECTIONS: Record<string, HomeSectionDef> = {
	services: {
		id: "services",
		lead: "Services",
		tail: "you may like",
		href: filterHref({ category: "services" }),
	},
	freelancers: {
		id: "freelancers",
		lead: "Freelancers",
		tail: "to watch out for",
		href: filterHref({ category: "freelancers" }),
	},
	projects: {
		id: "projects",
		lead: "Projects",
		tail: "worth your time",
		href: filterHref({ category: "projects" }),
	},
	products: {
		id: "products",
		lead: "Digital Products",
		tail: "you may need",
		href: filterHref({ category: "products" }),
	},
	articles: {
		id: "articles",
		lead: "Articles & Guides",
		tail: "to help you through",
		href: filterHref({ category: "articles" }),
	},
};
// #endregion

// #region Search Results sections
/**
 * The two-tone heading for each merged Search-Results section, keyed by `ResultGroup.key`.
 *
 * Results sections use the same rail module as the Home body, so they need the same split — but NOT
 * the same words. A Home tail is a recommendation ("you may like", "worth your time"); these are
 * matches against what the reader asked for, and a section that called them recommendations would be
 * claiming a judgement nobody made. Each tail names what the reader can DO with that category
 * instead, which is true whether they typed a query or only set a filter.
 *
 * App-side rather than on `ResultGroup`, deliberately. The split is a typographic contract between
 * `RailHeading` and its hosts — the same reason {@link HOME_SECTIONS} lives here — and `ResultGroup`
 * is a cross-boundary DTO in `@projective/types`, where adding two presentation strings would put the
 * copy behind a schema change and out of reach of the surface that renders it.
 */
export const RESULT_SECTIONS: Record<string, { lead: string; tail: string }> = {
	services: { lead: "Services", tail: "you can buy" },
	products: { lead: "Digital Products", tail: "you can download" },
	talent: { lead: "Freelancers & Teams", tail: "you can hire" },
	projects: { lead: "Projects", tail: "you can join" },
	people: { lead: "People & Businesses", tail: "you can work with" },
	articles: { lead: "Articles & Guides", tail: "you can read" },
};

/**
 * The heading for one merged Search-Results section.
 *
 * Total by construction: a group key with no entry above falls back to the group's own title as the
 * lead, so a section added to the backend's `RESULT_GROUPS` before this map renders with a plain
 * heading rather than an empty one. The section keys are the backend's, and a resolver that could
 * return nothing would make adding one a two-repository change.
 */
export function resultHeading(
	group: { key: string; title: string },
): { lead: string; tail: string } {
	return RESULT_SECTIONS[group.key] ?? { lead: group.title, tail: "in these results" };
}
// #endregion
