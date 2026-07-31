import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CatalogueHeader from "../islands/CatalogueHeader.island.tsx";
import ListingHeader from "../islands/ListingHeader.island.tsx";
import { resolveCataloguePage, resolveListing } from "./catalogue-ssr.ts";
import { toTypeFilter } from "./catalogue-model.ts";

/**
 * catalogue-header-slot — the SSR-idiomatic resolver for the middle-nav HEADER band on the Catalogue
 * surface (mirrors `walletHeaderFor` / `channelHeaderFor`). The surface previously had **no header
 * resolver at all**, so both its routes rendered with the band absent and pushed identity, search and
 * scope controls into the scrolling body.
 *
 * It claims BOTH routes, because both have an identity worth pinning: the console shows what you are
 * looking at plus the one search field and the analytics window; the manage page shows which listing
 * you are editing, its status and whether your work is saved.
 *
 * Server-only (reaches `@server/services` through `catalogue-ssr`); never imported by an island.
 */
export function catalogueHeaderFor(url: URL, context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["catalogue", id?]
	if (segs[0] !== "catalogue") return null;

	// The manage page: identity for the listing being edited.
	if (segs.length >= 2) {
		const listing = resolveListing(segs[1]);
		// An unknown id is already 303'd by the route; a null here just means no band rather than a throw.
		if (!listing) return null;
		return <ListingHeader title={listing.title} status={listing.status} />;
	}

	// The console: scope identity + the global search and analytics window.
	const type = toTypeFilter(url.searchParams.get("type"));
	const search = url.searchParams.get("search") ?? "";
	const { page } = resolveCataloguePage(context, {
		type,
		search: search || undefined,
	});
	return <CatalogueHeader type={type} initialTotal={page.total} initialSearch={search} />;
}
