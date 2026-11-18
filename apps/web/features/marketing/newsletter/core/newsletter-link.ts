import { NEWSLETTER_PATHS } from "@projective/types/community";

/**
 * newsletter-link — the addresses and headers of the newsletter mail's link (PRD-E11, the #445
 * pattern). Pure: the routes, the page handlers and the island share it.
 *
 * The mail opens a page that writes nothing; its one button posts the token to the endpoint beside
 * it, and the endpoint answers with a `303` back to the page, which then shows the address's new
 * standing. Every answer on this path is `noindex`, `no-store` and `no-referrer`, because the token
 * rides in the URL.
 */

/** The two pages a newsletter link opens. */
export type NewsletterLinkMode = "confirm" | "unsubscribe";

/** The one notice a page carries in its URL: the last press of Confirm was throttled. */
export const NEWSLETTER_THROTTLED_NOTICE = "throttled";

/** Headers for every response on the link's path. */
export const NEWSLETTER_LINK_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
	"cache-control": "private, no-store",
});

/** Where the footer's subscribe form sits on every public page (`PublicFooter`'s `id`). */
export const NEWSLETTER_FORM_ANCHOR = "#newsletter";

/** The page for `mode` and `token`, optionally carrying the throttled notice. */
export function newsletterPageHref(
	mode: NewsletterLinkMode,
	token: string | null,
	notice?: typeof NEWSLETTER_THROTTLED_NOTICE,
): string {
	const path = mode === "confirm" ? NEWSLETTER_PATHS.confirmPage : NEWSLETTER_PATHS.unsubscribePage;
	const params = new URLSearchParams();
	if (token) params.set("token", token);
	if (notice) params.set("notice", notice);
	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

/** A `303 See Other` on the link's path. */
export function newsletterRedirect(location: string): Response {
	return new Response(null, { status: 303, headers: { location, ...NEWSLETTER_LINK_HEADERS } });
}
