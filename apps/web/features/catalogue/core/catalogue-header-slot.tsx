import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import CatalogueHeader from "../islands/CatalogueHeader.island.tsx";
import ListingHeader from "../islands/ListingHeader.island.tsx";
import { consoleParamsOf, resolveCataloguePage, resolveListing } from "./catalogue-ssr.ts";
import { isListingSlug, parseConsoleUrl, parseWorkspaceUrl } from "../types/catalogue-types.ts";

/**
 * catalogue-header-slot — the SSR-idiomatic resolver for the middle-nav HEADER band on the Catalogue
 * surface (mirrors `walletHeaderFor` / `channelHeaderFor`). The surface previously had **no header
 * resolver at all**, so both its routes rendered with the band absent and pushed identity, search and
 * scope controls into the scrolling body.
 *
 * It claims BOTH routes, because both have an identity worth pinning: the console shows what you are
 * looking at, the one search field, the rollups and the view switch; the manage page shows which listing
 * you are editing, its status and whether your work is saved.
 *
 * The console's read is the SAME read the page makes ({@link consoleParamsOf}), so the request memo
 * answers both from one query.
 *
 * Server-only (reaches `@server/services` through `catalogue-ssr`); never imported by an island.
 */
export async function catalogueHeaderFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["catalogue", id?]
	if (segs[0] !== "catalogue") return null;

	// The workspace: the listing's identity, its save state and the tab strip.
	if (segs.length >= 2) {
		if (!isListingSlug(segs[1])) return null;
		const { listing } = await resolveListing(segs[1], url, actor);
		// A listing that is not theirs is 303'd by the route, and one that could not be read renders the
		// route's own "couldn't reach it" body — neither has an identity to pin, so no band.
		if (!listing) return null;
		return (
			<ListingHeader
				slug={listing.id}
				title={listing.title}
				status={listing.status}
				url={parseWorkspaceUrl(url)}
			/>
		);
	}

	// The console: identity, search, the rollups and the view switch, from the page's own read.
	const { page } = await resolveCataloguePage(context, url, actor, consoleParamsOf(url));
	return (
		<CatalogueHeader
			url={parseConsoleUrl(url)}
			initialTotal={page.total}
			initialStats={page.stats}
		/>
	);
}
