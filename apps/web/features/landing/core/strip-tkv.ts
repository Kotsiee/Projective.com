/**
 * strip-tkv — the landing pages' server-side answer to a `?tkv=` ticket deep link (Decision #286
 * (A), owner ruling 2026-10-18).
 *
 * `/` and `/features` never open a ticket: `ROUTING.md` strips the parameter and opens nothing on
 * the landing pages. The landing routes answer such a URL before rendering anything, with a
 * `303 See Other` to the same address without the parameter, so the public layout mounts no
 * browser-side `TicketDeepLinkHost` on its `LANDING_PATHS`. Each landing route's `GET` handler
 * calls {@link tkvRedirect} first and returns its response when there is one
 * (`landing-routes.test.ts` holds every `LANDING_PATHS` route to it).
 */
import { TICKET_PARAM } from "@features/projects/core/ticket-link.ts";

// #region Query parsing
/**
 * The decoded name of one `name=value` pair of a query string (`+` read as a space, as
 * `URLSearchParams` does); a name that is not valid percent-encoding is compared raw.
 */
function pairName(pair: string): string {
	const cut = pair.indexOf("=");
	const raw = (cut === -1 ? pair : pair.slice(0, cut)).replace(/\+/g, " ");
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
// #endregion

// #region Redirect
/**
 * The redirect that removes the ticket deep link from a landing URL, or `null` when `url` carries
 * none.
 *
 * Every `tkv` pair goes (an empty or repeated one too); every other pair is kept byte for byte and
 * in its order, so a search or a `?demo=` survives. The `Location` is the path and the remaining
 * query only: a server never sees the fragment, and the browser carries it across a redirect whose
 * `Location` has none. The path is pinned to one leading slash, so the `Location` never reads as a
 * protocol-relative address.
 *
 * @param url The request URL.
 * @returns A `303` to the stripped address, or `null` to render the page.
 */
export function tkvRedirect(url: URL): Response | null {
	if (url.search.length <= 1) return null;
	const kept: string[] = [];
	let found = false;
	for (const pair of url.search.slice(1).split("&")) {
		if (pair === "") continue;
		if (pairName(pair) === TICKET_PARAM) found = true;
		else kept.push(pair);
	}
	if (!found) return null;
	const path = `/${url.pathname.replace(/^\/+/, "")}`;
	const search = kept.length > 0 ? `?${kept.join("&")}` : "";
	return new Response(null, { status: 303, headers: { location: `${path}${search}` } });
}
// #endregion
