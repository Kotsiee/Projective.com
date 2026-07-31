import { computed, signal } from "@preact/signals";
import type {
	ConversationFilter,
	ConversationRelation,
	ConversationSummary,
	ConversationView,
	MessagingRole,
} from "../types/messaging-types.ts";

/**
 * inbox-state — the cross-island signal bridge for the `/messages` ROOT, where the inbox is composed
 * from four independently-hydrated regions that must agree on one query:
 *
 *  - the **lane** (scope: view partition + relation facet, with live counts),
 *  - the **header band** (identity + search + the id-based refinements + sort),
 *  - the **body** (the conversation list — the only region that owns data and fetches),
 *  - the **footer band** (New message · Settings · density).
 *
 * Each is a separate hydration root resolved by its own SSR slot, so they cannot share props. They
 * share this module instead — the same pattern the board footer↔body and explore filter-lane bridges
 * use. **The body is the single fetch owner**: every other region writes intent here and the body
 * reacts, so there is exactly one request path and no region can desynchronise from the data.
 *
 * Local per-conversation state (star · archive · mute · soft-delete) also lives here, because both the
 * body rows and the lane counts must reflect an optimistic toggle instantly.
 */

// #region Query intent (written by lane + header, read by body)
/** The acting inbox view (freelancer / client / business) — drives the relation facet set. */
export const inboxRole = signal<MessagingRole>("freelancer");

/** The partition: the whole inbox, or one of its saved slices. */
export const inboxView = signal<ConversationView>("inbox");

/** Unread-only narrowing, applied on top of the partition. */
export const inboxUnreadOnly = signal(false);

/** The single relation facet selected in the lane, or null for "every relation". */
export const inboxRelation = signal<ConversationRelation | null>(null);

/** The id-based refinements (service · product · entity) from the header-band filter popover. */
export const inboxFilter = signal<ConversationFilter>({});

/** The free-text query from the header band. */
export const inboxQuery = signal("");

/** Row density — the footer band's control. `comfortable` shows a two-line preview. */
export const inboxDensity = signal<InboxDensity>("comfortable");

/** Row density options. */
export type InboxDensity = "comfortable" | "compact";
// #endregion

// #region Data + status (written by the body, read by lane + header)
/** The full server set for the current role — the source for counts and facet options. */
export const inboxAll = signal<ConversationSummary[]>([]);

/**
 * Whether the body has seeded `inboxAll` yet.
 *
 * Explicit, because the obvious shorthand is wrong: `inboxAll.value.length === 0` conflates "not
 * loaded" with "loaded, and the answer is none". A search matching nothing is the second, and every
 * region that guessed from emptiness fell back to its SSR value — the header printed the full inbox
 * count above an empty list, and the body re-seeded the SSR rows over a zero-result query.
 */
export const inboxSeeded = signal(false);

/** A refine/refetch is in flight. */
export const inboxLoading = signal(false);

/** The last transport failure, or null. Rendered by the body; never swallowed. */
export const inboxError = signal<string | null>(null);

/** More pages exist beyond what is loaded. */
export const inboxHasMore = signal(false);

/** Total conversations the server reports for the current query (may exceed what is loaded). */
export const inboxTotal = signal(0);
// #endregion

// #region Local per-conversation preferences (optimistic, persisted by the body)
/** Viewer-local overrides layered over the server row. */
export interface ConvPref {
	starred?: boolean;
	archived?: boolean;
	muted?: boolean;
	deleted?: boolean;
}

export const inboxPrefs = signal<Record<string, ConvPref>>({});

/** Apply the local preference overlay to a server row. */
export function mergePref(
	c: ConversationSummary,
	prefs: Record<string, ConvPref>,
): ConversationSummary {
	const p = prefs[c.id];
	if (!p) return c;
	return {
		...c,
		starred: p.starred ?? c.starred,
		archived: p.archived ?? c.archived,
		muted: p.muted ?? c.muted,
	};
}

/** The pref-merged, non-deleted set — the basis for every count and every partition. */
export const inboxMerged = computed<ConversationSummary[]>(() => {
	const prefs = inboxPrefs.value;
	return inboxAll.value.filter((c) => !prefs[c.id]?.deleted).map((c) => mergePref(c, prefs));
});
// #endregion

// #region Derived counts (the lane's scope nav renders these)
/** Live counts per partition — what makes the lane a scope map rather than five unlabelled icons. */
export const inboxCounts = computed(() => {
	const all = inboxMerged.value;
	const active = all.filter((c) => !c.archived);
	return {
		inbox: active.length,
		unread: active.filter((c) => c.unread).length,
		starred: active.filter((c) => c.starred).length,
		archived: all.filter((c) => c.archived).length,
	};
});

/** Live counts per relation, within the current partition — the lane's second scope axis. */
export const relationCounts = computed<Record<string, number>>(() => {
	const out: Record<string, number> = {};
	for (const c of partitionOf(inboxMerged.value, inboxView.value)) {
		out[c.relation] = (out[c.relation] ?? 0) + 1;
	}
	return out;
});
// #endregion

// #region Pure partition / narrowing (shared by the body and the counts)
/** Slice the merged set by partition. Archived is its own space; the others exclude archived. */
export function partitionOf(
	list: readonly ConversationSummary[],
	view: ConversationView,
): ConversationSummary[] {
	if (view === "archived") return list.filter((c) => c.archived);
	if (view === "starred") return list.filter((c) => c.starred && !c.archived);
	return list.filter((c) => !c.archived);
}

/** Apply the lane's relation facet and the header's unread narrowing to a partition. */
export function narrow(
	list: readonly ConversationSummary[],
	relation: ConversationRelation | null,
	unreadOnly: boolean,
): ConversationSummary[] {
	return list.filter((c) => (!relation || c.relation === relation) && (!unreadOnly || c.unread));
}

/**
 * The rows the body is showing, derived from the shared signals.
 *
 * Both the body (to render) and the header band (to count) call THIS — they do not exchange the
 * result through a signal. An earlier version had the body publish its rows for the header to read,
 * and the header reported the previous interaction's count: two regions describing the same set
 * cannot be kept in step by copying it between them, only by deriving it from the same inputs.
 */
export function visibleConversations(): ConversationSummary[] {
	return narrow(
		partitionOf(inboxMerged.value, inboxView.value),
		inboxRelation.value,
		inboxUnreadOnly.value,
	);
}
// #endregion

// #region Commit seam (any region asks the body to refetch)
/** The body registers its fetch here on mount; every other region calls {@link commitInbox}. */
export const inboxCommit = signal<(() => void) | null>(null);

/** Ask the body to re-run its query. A no-op before the body hydrates (SSR paint is already correct). */
export function commitInbox(): void {
	inboxCommit.value?.();
}

/** Reset every narrowing control back to the whole inbox. */
export function clearInboxFilters(): void {
	inboxQuery.value = "";
	inboxRelation.value = null;
	inboxUnreadOnly.value = false;
	inboxFilter.value = {};
	commitInbox();
}

/** Whether anything is currently narrowing the set — drives the empty state's copy and its reset. */
export const inboxNarrowed = computed(() =>
	inboxQuery.value.trim().length > 0 || inboxRelation.value !== null ||
	inboxUnreadOnly.value ||
	(inboxFilter.value.serviceIds?.length ?? 0) + (inboxFilter.value.productIds?.length ?? 0) +
				(inboxFilter.value.entityIds?.length ?? 0) > 0
);
// #endregion
