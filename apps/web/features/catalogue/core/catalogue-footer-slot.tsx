import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CatalogueViewControlRig from "../islands/CatalogueViewControlRig.island.tsx";
import ListingActionRig from "../islands/ListingActionRig.island.tsx";
import { resolveListing } from "./catalogue-ssr.ts";

/**
 * catalogue-footer-slot — the SSR-idiomatic resolver for the middle-nav FOOTER band on the Catalogue
 * surface. Unlike its narrower siblings this resolver claims **every** `/catalogue*` route with a
 * per-route body, the `/wallet` shape: a band that exists on one page of a surface and vanishes on the
 * next teaches the user it is decorative, and the actions it should hold end up in the scroll flow.
 *
 *  - `/catalogue` → the {@link CatalogueViewControlRig}: density, sort, and a mobile-only create.
 *  - `/catalogue/[id]` → the {@link ListingActionRig}: the publish gate and its lifecycle actions,
 *    which used to sit in a `position: static` strip at the top of the editor body.
 *
 * Composed after the projects/messaging footer resolvers so exactly one owns the band per URL.
 */
export function catalogueFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["catalogue", id?]
	if (segs[0] !== "catalogue") return null;

	if (segs.length >= 2) {
		const listing = resolveListing(segs[1]);
		if (!listing) return null;
		return <ListingActionRig status={listing.status} />;
	}

	return <CatalogueViewControlRig />;
}
