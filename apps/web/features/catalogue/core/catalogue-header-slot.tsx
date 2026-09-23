import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import CatalogueHeader from "../islands/CatalogueHeader.island.tsx";
import ListingHeader from "../islands/ListingHeader.island.tsx";
import { consoleParamsOf, resolveCataloguePage, resolveListing } from "./catalogue-ssr.ts";
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

	// The manage page: identity for the listing being edited.
	if (segs.length >= 2) {
		const { listing } = await resolveListing(segs[1], url, actor);
		// A listing that is not theirs is 303'd by the route, and one that could not be read renders the
		// route's own "couldn't reach it" body — neither has an identity to pin, so no band.
		if (!listing) return null;
		return <ListingHeader title={listing.title} status={listing.status} />;
	}

	// The console: scope identity + the global search and analytics window.
	const search = url.searchParams.get("search") ?? "";
	const { page } = await resolveCataloguePage(context, url, actor, consoleParamsOf(url));
	return (
		<CatalogueHeader
			type={toTypeFilter(url.searchParams.get("type"))}
			initialTotal={page.total}
			initialSearch={search}
		/>
	);
}
