import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import { listingCardItem } from "@projective/types/explore";
import ListingInspector from "../islands/ListingInspector.island.tsx";
import { resolveListing } from "./catalogue-ssr.ts";
import { workspacePanelOf } from "./workspace-model.ts";
import { isListingSlug, parseWorkspaceUrl, publishReadiness } from "../types/catalogue-types.ts";

/**
 * catalogue-panel-slot — the middle-nav PANEL on the item workspace (plan §6.3): the live card and
 * publish checklist on the Edit tab, or the chosen buyer when `?client=` is set; nothing on
 * Preview, whose frame takes the full width, nor on a tab without a panel. The decision is the pure
 * `workspacePanelOf`, so the first byte and the island's own client-side switches agree.
 *
 * The listing is the same read the page and the bands make, through the request memo. Server-only;
 * never imported by an island.
 */
export async function cataloguePanelFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["catalogue", id]
	if (segs[0] !== "catalogue" || segs.length !== 2 || !isListingSlug(segs[1])) return null;

	const state = parseWorkspaceUrl(url);
	if (workspacePanelOf(state) === null) return null;

	const { listing } = await resolveListing(segs[1], url, actor);
	if (!listing) return null;
	return (
		<ListingInspector
			kind={listing.kind}
			serviceType={listing.serviceType}
			card={listingCardItem(listing)}
			readiness={publishReadiness(listing)}
			url={state}
		/>
	);
}
