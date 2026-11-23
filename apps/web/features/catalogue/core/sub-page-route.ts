import {
	formArchetypeOf,
	type ListingDetail,
	type ListingSubPage,
	SUB_PAGE_SECTION,
	workspaceHref,
} from "@projective/types/catalogue";

/**
 * Where a listing's sub-page request belongs instead, or `null` when the page serves it (Decision
 * #525): the session plan is a Session's or Group Session's alone, and buyer questions a service's,
 * so any other listing is sent back to the section of its own workspace the page would have edited.
 */
export function subPageRedirect(
	listing: Pick<ListingDetail, "id" | "kind" | "serviceType">,
	page: ListingSubPage,
	team?: string,
): string | null {
	const archetype = formArchetypeOf(listing.kind, listing.serviceType);
	const serves = page === "plan"
		? archetype === "session" || archetype === "cohort"
		: listing.kind === "service";
	if (serves) return null;
	return workspaceHref(listing.id, {
		team,
		section: page === "plan" ? SUB_PAGE_SECTION.plan : undefined,
	});
}
