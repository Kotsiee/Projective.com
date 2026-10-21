import { catalogueBase, isListingSlug, parseCataloguePath } from "@projective/types/catalogue";

/**
 * simulate-path — the address of a listing's buyer simulation (`/catalogue/[id]/simulate`, Decision
 * #217 (j), and its team twin `/teams/:handle/catalogue/[id]/simulate`, Decision #312) and the shell
 * chrome it runs in. Pure and total, so the dashboard layout can resolve the chrome in the first byte
 * (the `checkoutChromeFor` precedent) and the Preview tab can build the frame's `src` from the same
 * rule.
 */

/** The buyer simulation of the listing addressed by `slug`, in `team`'s catalogue when given. */
export function simulateHref(slug: string, team?: string): string {
	return `${catalogueBase(team)}/${encodeURIComponent(slug)}/simulate`;
}

/** The listing slug a simulate path addresses, or `null` when the path is not one. */
export function simulatedSlugOf(pathname: string): string | null {
	const rest = parseCataloguePath(pathname)?.rest;
	if (!rest || rest.length !== 2 || rest[1] !== "simulate") return null;
	return isListingSlug(rest[0]) ? rest[0] : null;
}

/**
 * The chrome a catalogue request runs in: `bare` for the buyer simulation (it is framed by the item
 * workspace, so it carries no rails, bands or top bar of its own), `null` for every other path.
 */
export function catalogueChromeFor(url: URL): "bare" | null {
	const rest = parseCataloguePath(url.pathname)?.rest;
	return rest?.length === 2 && rest[1] === "simulate" ? "bare" : null;
}
