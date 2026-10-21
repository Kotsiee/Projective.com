import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import CatalogueFooterRig from "../islands/CatalogueFooterRig.island.tsx";
import ListingActionRig from "../islands/ListingActionRig.island.tsx";
import { resolveListing } from "./catalogue-ssr.ts";
import { pathSellerScope } from "./seller-scope.ts";
import { isListingSlug, publishReadiness } from "../types/catalogue-types.ts";

/**
 * catalogue-footer-slot — the SSR-idiomatic resolver for the middle-nav FOOTER band on the Catalogue
 * surface. Unlike its narrower siblings this resolver claims **every** `/catalogue*` route with a
 * per-route body, the `/wallet` shape: a band that exists on one page of a surface and vanishes on the
 * next teaches the user it is decorative, and the actions it should hold end up in the scroll flow.
 *
 *  - `/catalogue` → the {@link CatalogueFooterRig}: density, or the batch bar while listings are
 *    selected.
 *  - `/catalogue/[id]` → the {@link ListingActionRig}: the publish gate and its lifecycle actions
 *    (Delete only while no buyer has engaged with the listing), which used to sit in a
 *    `position: static` strip at the top of the editor body.
 *
 * The same two bodies serve `/teams/:handle/catalogue*`, read as the team (Decision #312). Composed
 * after the projects/messaging footer resolvers and before the workspace one, so exactly one owns
 * the band per URL.
 */
export async function catalogueFooterFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const scope = await pathSellerScope(url, actor);
	if (!scope) return null;
	const [id] = scope.rest;

	if (id !== undefined) {
		if (!isListingSlug(id)) return null;
		// The same read the page and the header band make — one query through the request memo.
		const { listing } = await resolveListing(id, url, scope.actor);
		if (!listing) return null;
		return (
			<ListingActionRig
				slug={listing.id}
				status={listing.status}
				missing={publishReadiness(listing).missing}
				deletable={listing.deletable}
			/>
		);
	}

	return <CatalogueFooterRig />;
}
