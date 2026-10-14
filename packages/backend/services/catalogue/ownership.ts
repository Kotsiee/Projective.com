import type { ReadActor } from "../read-actor.ts";

/** The owner columns of a `catalogue.listings` row. */
export interface ListingOwnerColumns {
	owner_user_id: string;
	owner_team_id: string | null;
}

/**
 * Whether the actor manages this listing: a team listing in that team's acting context (or as the
 * person who created it, outside any team context), a personal listing as its owner. The console and
 * the owner's preview both ask this, so a listing is never manageable in one and hidden in the other.
 */
export function ownsListing(
	listing: ListingOwnerColumns,
	actor: Pick<ReadActor, "userId" | "contextType" | "contextId">,
): boolean {
	if (listing.owner_team_id) {
		return actor.contextType === "team"
			? actor.contextId === listing.owner_team_id
			: listing.owner_user_id === actor.userId;
	}
	return listing.owner_user_id === actor.userId;
}
