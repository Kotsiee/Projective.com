/**
 * robots — what crawlers may fetch (`GET /robots.txt`, PUBLIC_ROUTES P8, Decision #279). Pure: the
 * route hands it the site's public origin and answers the text.
 *
 * Disallowed:
 * - **The signed-in app** — every top-level segment the `(dashboard)` route group serves (its guard
 *   sends a crawler to `/login` anyway), plus the owner-only profile editor (`/:handle/edit`). `/legal`
 *   is public, so only its signed-in `/legal/workspace` is listed. `robots.test.ts` reads the route
 *   group and fails when a dashboard segment is missing here, or when a rule would catch a public page.
 * - **The API** (`/api/`), which serves no pages.
 * - **`?feedback=open`** on any page — the feedback drawer over a page is that page again (Decision
 *   #272), and the board's own page is `/feedback`.
 *
 * Each app path is written as three exact rules (`/home$`, `/home/`, `/home?`) rather than the bare
 * prefix: handles share the top-level namespace (`[handle]`), and a bare `Disallow: /home` would also
 * hide a profile at `/homer`. `*` and `$` are RFC 9309 §2.2.3 special characters (Google, Bing).
 *
 * Pages that must stay unindexed but fetchable — share links, the outbound-link interstitial, the
 * file inspector, legal drafts — say so with `noindex` on the page itself, which a crawler can only
 * read if it is allowed to fetch the page, so they are deliberately NOT disallowed here.
 *
 * @module
 */

// #region Rules
/** The signed-in app's paths — `routes/(dashboard)`'s top-level segments, and `/legal/workspace`. */
export const APP_PATHS: readonly string[] = [
	"/admin",
	"/basket",
	"/become-partner",
	"/businesses",
	"/calendar",
	"/catalogue",
	"/checkout",
	"/files",
	"/home",
	"/invite",
	"/legal/workspace",
	"/messages",
	"/notifications",
	"/projects",
	"/saved",
	"/services",
	"/settings",
	"/teams",
	"/wallet",
];

/** Where the sitemap is served (`GET /sitemap.xml`). */
export const SITEMAP_PATH = "/sitemap.xml";

/** Exact rules for one app path: the path itself, everything under it, and the path with a query. */
function exactRules(path: string): string[] {
	return [`${path}$`, `${path}/`, `${path}?`];
}

/** Every `Disallow` value, in the order the file lists them. */
export function disallowRules(): string[] {
	return [
		"/api/",
		...APP_PATHS.flatMap(exactRules),
		// The owner-only profile editor (`[handle]/edit`, `[handle]/edit/availability`).
		...exactRules("/*/edit"),
		"/*?feedback=open",
		"/*&feedback=open",
	];
}
// #endregion

// #region Matching
/**
 * Whether one robots.txt path rule matches a URL path (with its query), as RFC 9309 §2.2.2–2.2.3
 * reads it: a prefix match where `*` matches any run of characters and a trailing `$` anchors the end.
 */
export function ruleMatches(rule: string, pathAndQuery: string): boolean {
	const anchored = rule.endsWith("$");
	const body = anchored ? rule.slice(0, -1) : rule;
	const pattern = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(
		".*",
	);
	return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(pathAndQuery);
}

/** Whether this file keeps a crawler from `pathAndQuery` (no `Allow` rules, so any match blocks). */
export function isCrawlDisallowed(pathAndQuery: string): boolean {
	return disallowRules().some((rule) => ruleMatches(rule, pathAndQuery));
}
// #endregion

// #region The file
/**
 * The robots.txt body for `origin` (the site's public origin, no trailing slash): one group for every
 * crawler, then the sitemap's absolute address.
 */
export function buildRobotsTxt(origin: string): string {
	const lines = [
		"# Projective — what search engines may crawl. The signed-in app, the API and the feedback",
		"# drawer's ?feedback=open address are not pages to index; everything else public is listed in",
		"# the sitemap below.",
		"User-agent: *",
		...disallowRules().map((rule) => `Disallow: ${rule}`),
		"",
		`Sitemap: ${origin.replace(/\/+$/, "")}${SITEMAP_PATH}`,
	];
	return `${lines.join("\n")}\n`;
}
// #endregion
