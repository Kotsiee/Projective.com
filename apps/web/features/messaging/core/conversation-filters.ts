import type {
	ConversationListParams,
	ConversationRelation,
	ConversationSummary,
	MessagingRole,
} from "../types/messaging-types.ts";

/**
 * conversation-filters — the pure model behind the inbox sidebar's advanced filters (task §2A). It
 * declares the role-specific relation facets (a freelancer filters by Client / Co-Freelancers / Teams /
 * Team Members; a client/business by Businesses / Business Members / Hired Freelancers / Direct
 * Messages) and derives the id-based facet OPTIONS (Service · Product · Team/Business entity) from the
 * loaded conversation set. Kept DOM-free so the panel + the sidebar derive identical facets.
 */

// #region Relation facets (role-specific chips)
/** One relation chip in the advanced filter panel. */
export interface RelationFacet {
	relation: ConversationRelation;
	label: string;
}

/** The relation chips a given inbox view shows (task §2A). */
export function relationFacetsForRole(role: MessagingRole): RelationFacet[] {
	if (role === "freelancer") {
		return [
			{ relation: "client", label: "Clients" },
			{ relation: "co_freelancer", label: "Co-freelancers" },
			{ relation: "team", label: "Teams" },
			{ relation: "team_member", label: "Team members" },
			{ relation: "dm", label: "Direct messages" },
		];
	}
	// Client + business views share the buyer-side filter set.
	return [
		{ relation: "business", label: "Businesses" },
		{ relation: "business_member", label: "Business members" },
		{ relation: "hired_freelancer", label: "Hired freelancers" },
		{ relation: "dm", label: "Direct messages" },
	];
}

/** Whether the Service + Product id facets apply to a view (provider side only). */
export function showsOfferingFacets(role: MessagingRole): boolean {
	return role === "freelancer" || role === "business";
}
// #endregion

// #region Id-based facet options (derived from the loaded corpus)
/** A selectable id option (Service · Product · Team/Business). */
export interface FacetOption {
	id: string;
	label: string;
}

function distinct(pairs: Array<[string | null, string | null]>): FacetOption[] {
	const seen = new Map<string, string>();
	for (const [id, label] of pairs) {
		if (id && label && !seen.has(id)) seen.set(id, label);
	}
	return [...seen.entries()].map(([id, label]) => ({ id, label }));
}

/** The distinct services referenced by the loaded conversations. */
export function serviceOptions(list: readonly ConversationSummary[]): FacetOption[] {
	return distinct(list.map((c) => [c.serviceId, c.serviceName]));
}

/** The distinct products referenced by the loaded conversations. */
export function productOptions(list: readonly ConversationSummary[]): FacetOption[] {
	return distinct(list.map((c) => [c.productId, c.productName]));
}

/** The distinct teams/businesses referenced by the loaded conversations. */
export function entityOptions(list: readonly ConversationSummary[]): FacetOption[] {
	return distinct(list.map((c) => [c.entityId, c.entityName]));
}
// #endregion

// #region Active-count
/** How many advanced-filter values are currently applied (drives the trigger's active dot + count). */
export function activeFilterCount(params: ConversationListParams): number {
	const f = params.filter;
	if (!f) return 0;
	return (f.relations?.length ?? 0) + (f.serviceIds?.length ?? 0) + (f.productIds?.length ?? 0) +
		(f.entityIds?.length ?? 0) + (f.memberIds?.length ?? 0);
}

/** Toggle a value within an id array (immutable). */
export function toggleIn(arr: string[] | undefined, value: string): string[] {
	const set = new Set(arr ?? []);
	if (set.has(value)) set.delete(value);
	else set.add(value);
	return [...set];
}

/** Toggle a relation within the relations array (immutable). */
export function toggleRelation(
	arr: ConversationRelation[] | undefined,
	value: ConversationRelation,
): ConversationRelation[] {
	const set = new Set(arr ?? []);
	if (set.has(value)) set.delete(value);
	else set.add(value);
	return [...set];
}
// #endregion

// #region Sort
/** The inbox's sort keys: last activity, conversation title, or unread conversations first. */
export type ConversationSort = "recent" | "name" | "unread";

/** A sort direction. */
export type ConversationSortDir = "asc" | "desc";

/** The sort keys the filter popover offers, in display order. */
export const CONVERSATION_SORT_OPTIONS: readonly { value: ConversationSort; label: string }[] = [
	{ value: "recent", label: "Recent" },
	{ value: "name", label: "Name" },
	{ value: "unread", label: "Unread first" },
];

/** The resting sort: most recent activity first. */
export const DEFAULT_CONVERSATION_SORT: ConversationSort = "recent";

/** Whether a raw value is one of the {@link ConversationSort} keys. */
export function isConversationSort(value: unknown): value is ConversationSort {
	return CONVERSATION_SORT_OPTIONS.some((o) => o.value === value);
}

/** Whether a raw value is a {@link ConversationSortDir}. */
export function isConversationSortDir(value: unknown): value is ConversationSortDir {
	return value === "asc" || value === "desc";
}

/** The direction a sort key opens in: newest and unread first, names A–Z. */
export function defaultConversationSortDir(sort: ConversationSort): ConversationSortDir {
	return sort === "name" ? "asc" : "desc";
}

/** Whether a sort differs from the resting recent / descending order. */
export function isDefaultConversationSort(
	sort: ConversationSort,
	dir: ConversationSortDir,
): boolean {
	return sort === DEFAULT_CONVERSATION_SORT && dir === defaultConversationSortDir(sort);
}

function compareBy(sort: ConversationSort, a: ConversationSummary, b: ConversationSummary): number {
	if (sort === "name") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
	if (sort === "unread") {
		return Number(a.unread) - Number(b.unread) || a.updatedAt.localeCompare(b.updatedAt);
	}
	return a.updatedAt.localeCompare(b.updatedAt);
}

/**
 * The conversations in a new array ordered by `sort` in `dir`; ties fall back to the id so the order
 * is stable across reads.
 */
export function sortConversations(
	list: readonly ConversationSummary[],
	sort: ConversationSort,
	dir: ConversationSortDir,
): ConversationSummary[] {
	const sign = dir === "asc" ? 1 : -1;
	return [...list].sort((a, b) => sign * compareBy(sort, a, b) || a.id.localeCompare(b.id));
}
// #endregion
