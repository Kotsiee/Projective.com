import { filterHref } from "./routing.ts";

/**
 * Explore Home — the pure configuration behind the above-the-fold chrome and the body's section rail.
 *
 * Everything here is a projection over URL vocabulary the app already owns: no fetching, no clock, no
 * DOM. It lives outside the components so the section headings cannot drift from each other or from
 * what `/explore` will actually parse when the reader arrives there — a heading whose "See all" lands
 * on the unfiltered feed is worse than none.
 */

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
