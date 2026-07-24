import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CatalogueViewControlRig from "../islands/CatalogueViewControlRig.island.tsx";

/**
 * catalogue-footer-slot — the SSR-idiomatic resolver for the middle-nav FOOTER band on the Catalogue
 * console (`/catalogue`, the list surface). It mounts the zoom {@link CatalogueViewControlRig} (mirrors
 * `filesFooterFor`), a dumb island driving the shared catalogue zoom signal — so it stays a pure URL
 * match. The manage page (`/catalogue/[id]`) is NOT the console, so it gets no rig (its status controls
 * live in the editor). Returns `null` everywhere else. Composed after the projects/messaging footer
 * resolvers so exactly one owns the footer band per URL.
 */
export function catalogueFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["catalogue", id?]
	if (segs[0] !== "catalogue" || segs.length !== 1) return null;
	return <CatalogueViewControlRig />;
}
