import type {
	CatalogueListParams,
	CatalogueStatusCounts,
	ListingStatus,
	ListingSummary,
} from "@projective/types/catalogue";
import { listingHref, publicListingHref } from "@features/catalogue/core/catalogue-model.ts";

/**
 * catalogue-module-model — the pure decisions behind a team console's Catalogue module (Decision
 * #308): what is read, how the listings are narrowed on the page, where each one links, and what the
 * module says to a member acting as the team versus one acting as themselves.
 *
 * Team only: a business keeps no catalogue (PRODUCT_SPEC — a Business shows no seller surface), and the
 * registry offers the module to a team member holding `publish_listings`.
 *
 * ## Why acting matters here and nowhere else in the console
 * The catalogue's manage page and every listing write resolve ownership from the session's ACTING
 * context (`ownsListing`: a team listing is the actor's to manage while they act as that team), and a
 * new listing is created in the acting context. So a member reading this module as themselves can see
 * the team's listings — RLS lets every active member read them — but editing one, or adding one, has
 * to happen as the team. The module says so and offers the switch rather than links that would 404 or
 * file a new listing under the member's own name.
 */

// #region Read
/**
 * The one read the module paints from: every listing the team has, newest edit first, at the largest
 * page the service serves (the catalogue lane's own outline read). Narrowing happens on the page.
 */
export const TEAM_CATALOGUE_PARAMS: CatalogueListParams = {
	type: "all",
	sort: "recent",
	limit: 200,
};
// #endregion

// #region Filter
/** The status narrowing: one lifecycle state, or every listing. */
export type CatalogueStatusFilter = "all" | ListingStatus;

/** What the page narrows the listings by. */
export interface CatalogueFilter {
	status: CatalogueStatusFilter;
	search: string;
}

/** No narrowing. */
export const NO_CATALOGUE_FILTER: Readonly<CatalogueFilter> = { status: "all", search: "" };

/** The listings matching `filter`: by status, then by a case-insensitive title or category match. */
export function filterTeamListings(
	items: readonly ListingSummary[],
	filter: CatalogueFilter,
): ListingSummary[] {
	const q = filter.search.trim().toLowerCase();
	return items.filter((l) =>
		(filter.status === "all" || l.status === filter.status) &&
		(!q || l.title.toLowerCase().includes(q) || l.category.toLowerCase().includes(q))
	);
}

const STATUS_ORDER: readonly { value: ListingStatus; label: string }[] = [
	{ value: "published", label: "Published" },
	{ value: "draft", label: "Drafts" },
	{ value: "paused", label: "Paused" },
	{ value: "archived", label: "Archived" },
];

/** The status options with their counts; a state with no listings is left out unless it is chosen. */
export function statusFilterOptions(
	counts: CatalogueStatusCounts,
	chosen: CatalogueStatusFilter = "all",
): { label: string; value: CatalogueStatusFilter }[] {
	const total = counts.draft + counts.published + counts.paused + counts.archived;
	return [
		{ label: `All (${total})`, value: "all" },
		...STATUS_ORDER.filter((s) => counts[s.value] > 0 || s.value === chosen).map((s) => ({
			label: `${s.label} (${counts[s.value]})`,
			value: s.value,
		})),
	];
}

/** How many listings the narrowing shows, as the toolbar reads it. */
export function matchLabel(shown: number, total: number): string {
	if (shown === total) return `${total} ${total === 1 ? "listing" : "listings"}`;
	return `${shown} of ${total}`;
}
// #endregion

// #region Links
/**
 * Where a listing's card links. Acting as the team: its manage page (`/catalogue/[slug]`). Acting as
 * oneself: its public page when it is published, and nowhere otherwise — the manage page would answer
 * 404 to a member who is not acting as the team, and a draft has no public page.
 */
export function teamListingHref(
	listing: Pick<ListingSummary, "id" | "kind" | "status">,
	acting: boolean,
): string | null {
	if (acting) return listingHref(listing.id);
	return listing.status === "published" ? publicListingHref(listing) : null;
}

/** The catalogue's Quick-Init create modal — opened by the console route, in the acting context. */
export const NEW_LISTING_HREF = "/catalogue?create=1";

/** The full seller console. */
export const CATALOGUE_HREF = "/catalogue";

/**
 * The header band's one filled action: New listing (tier 2, structural creation) — only while acting
 * as the team, since the create modal files the listing under the acting seller.
 */
export function catalogueCommit(
	acting: boolean,
): { key: "new-listing"; label: string; tier: 2 } | null {
	return acting ? { key: "new-listing", label: "New listing", tier: 2 } : null;
}
// #endregion

// #region View
/** What the module says to one viewer. */
export interface TeamCatalogueView {
	note: string;
	/** Why editing waits on the switch, when the viewer is acting as themselves. */
	actingNote: string | null;
	emptyNote: string;
	noMatchNote: string;
}

/** The Catalogue module's view for one viewer of one team. */
export function teamCatalogueView(facts: { name: string; acting: boolean }): TeamCatalogueView {
	return {
		note: `The services and products ${facts.name} sells as one seller.`,
		actingNote: facts.acting
			? null
			: `You're acting as yourself. Act as ${facts.name} to add or edit its listings — anything you create now is filed under your own name.`,
		emptyNote: facts.acting
			? `${facts.name} has no listings yet. A new listing is a draft until you publish it.`
			: `${facts.name} has no listings yet.`,
		noMatchNote: "No listing matches. Clear the search or choose another status.",
	};
}
// #endregion
