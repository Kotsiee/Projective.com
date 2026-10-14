import { isListingSlug } from "@projective/types/catalogue";

/**
 * simulate-path — the address of a listing's buyer simulation (`/catalogue/[id]/simulate`, Decision
 * #217 (j)) and the shell chrome it runs in. Pure and total, so the dashboard layout can resolve the
 * chrome in the first byte (the `checkoutChromeFor` precedent) and the Preview tab can build the frame's
 * `src` from the same rule.
 */

const SIMULATE_PATH = /^\/catalogue\/([^/]+)\/simulate\/?$/;

/** The buyer simulation of the listing addressed by `slug`. */
export function simulateHref(slug: string): string {
	return `/catalogue/${encodeURIComponent(slug)}/simulate`;
}

/** The listing slug a simulate path addresses, or `null` when the path is not one. */
export function simulatedSlugOf(pathname: string): string | null {
	const match = SIMULATE_PATH.exec(pathname);
	if (!match) return null;
	let slug: string;
	try {
		slug = decodeURIComponent(match[1]);
	} catch {
		return null;
	}
	return isListingSlug(slug) ? slug : null;
}

/**
 * The chrome a catalogue request runs in: `bare` for the buyer simulation (it is framed by the item
 * workspace, so it carries no rails, bands or top bar of its own), `null` for every other path.
 */
export function catalogueChromeFor(url: URL): "bare" | null {
	return SIMULATE_PATH.test(url.pathname) ? "bare" : null;
}
