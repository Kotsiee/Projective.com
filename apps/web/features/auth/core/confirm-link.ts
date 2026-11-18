/**
 * confirm-link — the addresses and headers of the confirmation email's link (Decision #445).
 *
 * The email opens {@link CONFIRM_PAGE_PATH}, a page that spends nothing: the one-time `token_hash` is
 * exchanged only by the person's own press of its button, a form post to
 * {@link CONFIRM_ENDPOINT}. A mail scanner that follows the link therefore leaves the token unspent.
 */

/** The page the confirmation email's button opens; it renders a Confirm button and nothing else. */
export const CONFIRM_PAGE_PATH = "/verify/confirm";

/** Where the page's form posts the token; the older GET form of the link 303s to the page. */
export const CONFIRM_ENDPOINT = "/api/auth/confirm";

/** Where a malformed, expired or already-spent link ends. */
export const CONFIRM_FAILED_PATH = "/login?notice=confirm_failed";

/** The one notice the confirm page shows: the press was throttled and the token is still unspent. */
export const CONFIRM_THROTTLED_NOTICE = "throttled";

/**
 * Headers for every response on the confirmation path: the token rides in the URL, so it is never
 * indexed, cached or sent onward as a referrer.
 */
export const CONFIRM_LINK_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
	"cache-control": "private, no-store",
});

/** The confirm page's address for a link, optionally carrying the throttled notice. */
export function confirmPageHref(
	link: { token_hash: string; type: string },
	notice?: typeof CONFIRM_THROTTLED_NOTICE,
): string {
	const params = new URLSearchParams({ token_hash: link.token_hash, type: link.type });
	if (notice) params.set("notice", notice);
	return `${CONFIRM_PAGE_PATH}?${params.toString()}`;
}

/** A `303 See Other` on the confirmation path, carrying any session cookies it mints. */
export function confirmRedirect(location: string, cookies: readonly string[] = []): Response {
	const res = new Response(null, { status: 303, headers: { location, ...CONFIRM_LINK_HEADERS } });
	for (const cookie of cookies) res.headers.append("set-cookie", cookie);
	return res;
}
