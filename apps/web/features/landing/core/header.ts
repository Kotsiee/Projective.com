/**
 * header.ts — the guest header's shared data (`flows/LANDING.md` §2.1–§2.3, §2.6, §2.8, §4.0): its
 * "Main" links, which of them is the page the visitor is on, and the geometry that decides when the
 * bar is "at the top" of the page.
 *
 * `SiteHeader` (`features/marketing/islands/`), the one header every guest page and the landing
 * pages wear, renders the links in the bar and in its drawer, and reads the band to decide when it
 * docks. Kept apart from the island so the links can be checked against the landing's own
 * anchors and the route tree under `deno test`.
 */

// #region Navigation
/** One link in the bar's "Main" navigation. */
export interface LandingNavLink {
	label: string;
	href: string;
}

/** The page whose sections the bar's anchors land on (Decision #349 moved them off `/`). */
const ANCHOR_PAGE = "/features";

/**
 * The bar's links (`flows/LANDING.md` §4.0), in its order: "How it works" (`/features#demo`, the demo
 * stage — the money flow it used to name left with `/`'s landing, Decision #349) · "Explore" (the
 * item that carries the discovery megamenu) · "Pricing" (`/features#pricing`) · "Features"
 * (`/features`, the chapter index of everything Projective does, L5). An entry is listed only once
 * its destination exists — a link to a page or an anchor that is not there would render and do
 * nothing (root CLAUDE.md §3 gate 11). The anchors are written with their page, so they land on its
 * sections from any page the bar renders on.
 */
export const LANDING_NAV_LINKS: readonly LandingNavLink[] = [
	{ label: "How it works", href: `${ANCHOR_PAGE}#demo` },
	{ label: "Explore", href: "/explore" },
	{ label: "Pricing", href: `${ANCHOR_PAGE}#pricing` },
	{ label: "Features", href: ANCHOR_PAGE },
];

/** The anchors the bar links to on `/features` (`demo`, `pricing`). */
export function landingNavAnchors(links: readonly LandingNavLink[] = LANDING_NAV_LINKS): string[] {
	return links.flatMap((link) =>
		link.href.startsWith(`${ANCHOR_PAGE}#`) ? [link.href.slice(ANCHOR_PAGE.length + 1)] : []
	);
}

/** A site-relative address without its query and fragment (`/features?x#y` → `/features`). */
function pathOf(address: string): string {
	return address.split(/[?#]/, 1)[0];
}

/**
 * Whether `link` is the page the visitor is on (`page`: its path, with or without a query), so it
 * carries `aria-current="page"` (`flows/LANDING.md` §2.6 note 1). Only a link to a whole page can be:
 * "How it works" and "Pricing" name sections of `/features`, never the page itself, so on `/features`
 * exactly "Features" is current, and on `/` (the Explore Home) none is.
 */
export function isCurrentNavLink(link: LandingNavLink, page: string): boolean {
	return !link.href.includes("#") && pathOf(link.href) === pathOf(page);
}
// #endregion

// #region Geometry
/**
 * The scroll offset (CSS px) up to which the bar counts as at the top of the page. Past it the
 * floating, inset bar docks: it widens to the viewport's edges, shortens, and takes its hairline.
 */
export const HEADER_TOP_BAND_PX = 20;
// #endregion
