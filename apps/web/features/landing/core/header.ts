/**
 * header.ts — the header bar's shared data (`flows/LANDING.md` §2.1–§2.3, §2.8, §4.0): its "Main"
 * links and the geometry that decides when the bar is "at the top" of the page.
 *
 * `LandingHeader` renders the links in the bar and in its menu sheet, and reads the band to decide
 * where it wears no glass and no hairline. Kept apart from the island so the links can be checked
 * against the page's own anchors under `deno test`.
 */

// #region Navigation
/** One link in the bar's "Main" navigation. */
export interface LandingNavLink {
	label: string;
	href: string;
	/** Shown in the bar from `--bp-lg` only (the hero is the search below that); always in the sheet. */
	wide?: boolean;
}

/**
 * The bar's links (`flows/LANDING.md` §4.0), in its order: "How it works" (`/#how-it-works`, the
 * money flow) · "Explore" · "Pricing" (`/#pricing`). An entry is listed only once its destination
 * exists, so "Features" (`/features`) waits for that page to ship — a link to a page or an anchor
 * that is not there would render and do nothing (root CLAUDE.md §3 gate 11). The two anchors are
 * written from `/`, so they land on the landing's sections from any page the bar renders on.
 * Explore joins the bar at `--bp-lg` (§2.2 note 1): below that the hero's own search stands in for
 * it; the menu sheet lists every link.
 */
export const LANDING_NAV_LINKS: readonly LandingNavLink[] = [
	{ label: "How it works", href: "/#how-it-works" },
	{ label: "Explore", href: "/explore", wide: true },
	{ label: "Pricing", href: "/#pricing" },
];

/** The in-page anchors the bar links to on `/` (`how-it-works`, `pricing`). */
export function landingNavAnchors(links: readonly LandingNavLink[] = LANDING_NAV_LINKS): string[] {
	return links.flatMap((link) => link.href.startsWith("/#") ? [link.href.slice(2)] : []);
}
// #endregion

// #region Geometry
/**
 * The scroll offset (CSS px) up to which the bar counts as at the top of the page. Past it the bar
 * always wears its glass and its bottom hairline.
 */
export const HEADER_TOP_BAND_PX = 48;
// #endregion
