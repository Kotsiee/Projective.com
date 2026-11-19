import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import type { ViewedListingEntity } from "@projective/types/explore";
import { discoverySessionId, sendDiscoveryBatch } from "@features/explore/core/discovery-beacon.ts";

/**
 * ListingViewBeacon — reports that a listing's own page was shown. Renders NOTHING.
 *
 * Mounted by `EntityViewPage` on a service or product page a reader evaluates (never the owner's
 * preview or buyer simulation, never for a restricted account), it sends ONE `discovery.view` to
 * `POST /api/explore/events` after hydration, as soon as the tab is visible: a page opened in a
 * background tab, or prerendered, counts when the reader first sees it, and not before. The server
 * decides the rest: the catalogue resolves the slug, a seller's view of their own listing is dropped,
 * and at most one view per viewer per listing per 30 minutes is stored
 * (`search.trg_interest_events_view`), which the seller's listing analytics roll up.
 */
export interface ListingViewBeaconProps {
	/** The listing's public id (its slug). */
	itemId: string;
	/** Which listing kind the page is. */
	itemType: ViewedListingEntity;
}

export default function ListingViewBeacon(
	{ itemId, itemType }: ListingViewBeaconProps,
): JSX.Element | null {
	useEffect(() => {
		const report = () =>
			sendDiscoveryBatch({
				sessionId: discoverySessionId(),
				surface: "view.entity",
				events: [{ name: "discovery.view", itemId, itemType, at: Date.now() }],
			});
		if (document.visibilityState === "visible") {
			report();
			return;
		}
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			document.removeEventListener("visibilitychange", onVisible);
			report();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [itemId, itemType]);

	return null;
}
