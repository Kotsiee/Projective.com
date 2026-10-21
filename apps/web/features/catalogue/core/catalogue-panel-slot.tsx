import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import { listingCardItem } from "@projective/types/explore";
import ListingInspector from "../islands/ListingInspector.island.tsx";
import ClientDrawer from "../islands/ClientDrawer.island.tsx";
import { resolveListing } from "./catalogue-ssr.ts";
import { pathSellerScope } from "./seller-scope.ts";
import { isSeller } from "./catalogue-model.ts";
import { consolePanelOf } from "./client-model.ts";
import { workspacePanelOf } from "./workspace-model.ts";
import {
	isListingSlug,
	parseConsoleUrl,
	parseWorkspaceUrl,
	publishReadiness,
} from "../types/catalogue-types.ts";

/**
 * catalogue-panel-slot — the middle-nav PANEL on the Catalogue (plan §6.3), last on the frame's
 * panel ladder:
 *
 * - the console (`/catalogue`): the client drawer on the Clients view whenever `?client=` names a
 *   buyer, and nothing on any other view;
 * - the item workspace (`/catalogue/[id]`): the live card and publish checklist on the Edit tab, or
 *   the client drawer when `?client=` is set; nothing on Preview, whose frame takes the full width,
 *   nor on a tab without a panel.
 *
 * Each decision is a pure resolver (`consolePanelOf`, `workspacePanelOf`), so the first byte and the
 * islands' own client-side switches agree. `/teams/:handle/catalogue*` gets the same panels, read as
 * the team (Decision #312). The workspace's listing is the same read the page and the
 * bands make, through the request memo. Server-only; never imported by an island.
 */
export async function cataloguePanelFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const scope = await pathSellerScope(url, actor);
	if (!scope) return null;
	const [id] = scope.rest;

	if (id === undefined) {
		const state = parseConsoleUrl(url);
		if ((!scope.team && !isSeller(context)) || consolePanelOf(state) === null) return null;
		return <ClientDrawer surface="console" scope={{ filter: state.scope }} client={state.client} />;
	}

	if (scope.rest.length !== 1 || !isListingSlug(id)) return null;
	const state = parseWorkspaceUrl(url);
	if (workspacePanelOf(state) === null) return null;

	const { listing } = await resolveListing(id, url, scope.actor);
	if (!listing) return null;
	return (
		<ListingInspector
			slug={listing.id}
			kind={listing.kind}
			serviceType={listing.serviceType}
			card={listingCardItem(listing)}
			readiness={publishReadiness(listing)}
			url={state}
		/>
	);
}
