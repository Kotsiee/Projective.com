import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/inbox.css";
import { Button } from "@projective/ui/fields";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { InboxRow } from "../components/InboxRow.tsx";
import {
	InboxListSkeleton,
	InboxLoadingStatus,
	skeletonRowCount,
} from "../components/InboxSkeletons.tsx";
import { MessagingService } from "../core/MessagingService.ts";
import { conversationHref } from "../core/conversation-model.ts";
import { groupByDay } from "../core/inbox-model.ts";
import { openNewConversation } from "../core/messaging-state.ts";
import { liveMessagingRole, readDevSeam, subscribeDevSeam } from "../core/messaging-view.ts";
import {
	clearInboxFilters,
	commitInbox,
	type ConvPref,
	inboxAll,
	inboxCommit,
	inboxDensity,
	inboxError,
	inboxFilter,
	inboxHasMore,
	inboxLoading,
	inboxNarrowed,
	inboxPrefs,
	inboxQuery,
	inboxRelation,
	inboxRole,
	inboxSeeded,
	inboxTotal,
	inboxUnreadOnly,
	inboxView,
	visibleConversations,
} from "../core/inbox-state.ts";
import type { ConversationListPage, MessagingRole } from "../types/messaging-types.ts";

/**
 * InboxView — the `/messages` BODY. This is the surface: the conversation list renders here, in the
 * content region, not in the 280px navigation lane.
 *
 * That placement is the region contract (`/wallet` is the reference — the lane is an accelerator, the
 * body is the surface), and it is also what makes the route survive the shell's `max-width: 767px`
 * rule, which removes the lane entirely. With the list in the body, losing the lane costs the viewer
 * their scope shortcuts, not their inbox.
 *
 * **This island is the single fetch owner.** The lane, header band and footer band write query intent
 * into `inbox-state` and call `commitInbox()`; only this component talks to {@link MessagingService},
 * so there is one request path and no region can drift from the data it is describing.
 *
 * THIN: first paint comes from SSR props; every refine goes through `/api/messaging/conversations`.
 * The per-conversation actions (star · mute · archive · soft-delete) are optimistic overlays persisted
 * to `localStorage`, so they land instantly and the lane's counts move with them.
 */

// #region Props
export interface InboxViewProps {
	initial: ConversationListPage;
	/** The SSR messaging-view baseline (freelancer / client / business). */
	role: MessagingRole;
	/** SSR pathname — seeds the active-row highlight when a conversation is open. */
	path: string;
}
// #endregion

/**
 * How long a fetch must stay in flight before the placeholder replaces the list.
 *
 * The header band's search is debounced at 220ms and the fixtures answer in single-digit
 * milliseconds, so a threshold-free skeleton would flash between one keystroke and the next — a
 * strobe that reads as breakage rather than progress. Past this point the wait is long enough to be
 * worth explaining.
 */
const SKELETON_DELAY_MS = 180;

export default function InboxView(props: InboxViewProps): JSX.Element {
	// #region Local state
	const reqId = useRef(0);

	/*
	 * Seed the shared signals synchronously so the SSR markup and the first client render agree.
	 *
	 * The guard is an explicit one-shot ref, NOT an emptiness test. Guarding on
	 * `inboxAll.value.length === 0` looks equivalent and is not: a search that legitimately matches
	 * nothing sets the list empty, which re-satisfies the condition on the very next render and
	 * re-seeds the original SSR conversations — so a zero-result query silently rendered the full
	 * inbox back. Empty is a real value here; only "have we seeded yet" may gate the seed.
	 */
	const seeded = useRef(false);
	if (!seeded.current) {
		seeded.current = true;
		inboxSeeded.value = true;
		inboxAll.value = props.initial.conversations;
		inboxTotal.value = props.initial.total;
		inboxHasMore.value = props.initial.hasMore;
		inboxRole.value = props.role;
	}
	// #endregion

	// #region Fetch (the one request path)
	/**
	 * The in-flight flag is cleared in a `finally`, under the request-staleness guard.
	 *
	 * Every other arrangement leaks it on some path, and a leaked flag is now load-bearing: the
	 * placeholder is gated on it, so a flag that never clears is a placeholder that never stops. The
	 * guard is what keeps a superseded request from clearing anything — the newer request it lost to
	 * owns both the flag and the answer.
	 */
	async function apply(): Promise<void> {
		const id = ++reqId.current;
		inboxLoading.value = true;
		inboxError.value = null;

		const relations = inboxRelation.value ? [inboxRelation.value] : undefined;
		try {
			const res = await MessagingService.conversations({
				q: inboxQuery.value || undefined,
				role: inboxRole.value,
				unread: inboxUnreadOnly.value || undefined,
				filter: relations ? { ...inboxFilter.value, relations } : inboxFilter.value,
			});

			if (id !== reqId.current) return; // superseded by a newer request

			if (res.ok && res.data) {
				inboxAll.value = res.data.page.conversations;
				inboxTotal.value = res.data.page.total;
				inboxHasMore.value = res.data.page.hasMore;
			} else {
				// The transport already returns a soft, human message — surface it rather than rendering
				// a failed fetch as an empty inbox, which would teach the viewer something untrue.
				inboxError.value = res.message ?? "Couldn't load your conversations.";
			}
			persist();
		} catch {
			// The transport folds its own failures into a soft result rather than throwing, so reaching
			// here means something below it did not. It still resolves to a stated failure.
			if (id === reqId.current) inboxError.value = "Couldn't load your conversations.";
		} finally {
			if (id === reqId.current) inboxLoading.value = false;
		}
	}

	function persist(): void {
		writeStored(
			"local",
			LocalKeys.MESSAGES_FILTERS,
			JSON.stringify({
				q: inboxQuery.value,
				view: inboxView.value,
				unread: inboxUnreadOnly.value,
				relation: inboxRelation.value,
				filter: inboxFilter.value,
			}),
		);
	}
	// #endregion

	// #region Hydrate: prefs, saved query, density, dev-seam role, and the commit seam
	useEffect(() => {
		const rawPrefs = readStored("local", LocalKeys.CONVERSATION_PREFS);
		if (rawPrefs) {
			try {
				inboxPrefs.value = JSON.parse(rawPrefs) as Record<string, ConvPref>;
			} catch { /* corrupt — ignore */ }
		}

		const rawDensity = readStored("local", LocalKeys.MESSAGES_DENSITY);
		if (rawDensity === "compact" || rawDensity === "comfortable") inboxDensity.value = rawDensity;

		let restored = false;
		const rawFilters = readStored("local", LocalKeys.MESSAGES_FILTERS);
		if (rawFilters) {
			try {
				const saved = JSON.parse(rawFilters) as Record<string, unknown>;
				if (typeof saved.q === "string" && saved.q) inboxQuery.value = saved.q;
				if (typeof saved.view === "string") inboxView.value = saved.view as never;
				if (saved.unread === true) inboxUnreadOnly.value = true;
				if (typeof saved.relation === "string") inboxRelation.value = saved.relation as never;
				if (saved.filter && typeof saved.filter === "object") {
					inboxFilter.value = saved.filter as never;
				}
				restored = true;
			} catch { /* ignore */ }
		}

		// Register the commit seam so the lane / header / footer can ask for a refetch.
		inboxCommit.value = () => void apply();

		// Dev-seam messaging-view override + live subscription (no reload on an axis change).
		const recompute = () => {
			const next = liveMessagingRole(props.role, readDevSeam());
			if (next !== inboxRole.value) {
				inboxRole.value = next;
				inboxRelation.value = null; // the facet set changes with the role
				void apply();
			}
		};
		recompute();
		const unsub = subscribeDevSeam(recompute);

		if (restored) void apply();

		return () => {
			inboxCommit.value = null;
			unsub();
		};
	}, []);

	// #endregion

	// #region Derived
	const activeId = (() => {
		const segs = props.path.split("/").filter(Boolean);
		return segs[0] === "messages" && segs.length >= 2 ? segs[1] : null;
	})();

	// The same pure derivation the header band runs, from the same shared signals. Publishing this
	// through a signal instead left the header one interaction behind the list it was counting.
	const rows = useComputed(() => visibleConversations());

	const groups = useComputed(() => groupByDay(rows.value));
	const compact = useComputed(() => inboxDensity.value === "compact");
	// #endregion

	// #region Loading placeholder
	/*
	 * The placeholder is gated on the FETCH LIFECYCLE and on nothing else.
	 *
	 * The tempting condition is "loading, and there is nothing on screen" — and it is the same trap
	 * the seed guard above documents, one surface further on. A query that legitimately matches
	 * nothing is empty, so an emptiness-gated placeholder covers the empty state that was supposed to
	 * explain it, and pairs with the `!loading` empty state to leave a wait that resolves badly
	 * showing neither. Emptiness is an answer, not a stage; only the request can say whether one is
	 * outstanding.
	 *
	 * The row COUNT is a different question, and there emptiness is exactly the right input: the
	 * placeholder mirrors the list it is replacing so the swap costs no height.
	 */
	const skeleton = useSignal(false);
	const skeletonRows = useSignal(0);

	useSignalEffect(() => {
		if (!inboxLoading.value) {
			skeleton.value = false;
			return;
		}
		const timer = setTimeout(() => {
			skeletonRows.value = skeletonRowCount(rows.peek().length);
			skeleton.value = true;
		}, SKELETON_DELAY_MS);
		return () => clearTimeout(timer);
	});
	// #endregion

	// #region Optimistic per-conversation actions
	function updatePref(id: string, patch: ConvPref): void {
		const next = { ...inboxPrefs.value, [id]: { ...inboxPrefs.value[id], ...patch } };
		inboxPrefs.value = next;
		writeStored("local", LocalKeys.CONVERSATION_PREFS, JSON.stringify(next));
	}
	function flag(id: string, key: keyof ConvPref, base: boolean): boolean {
		return inboxPrefs.value[id]?.[key] ?? base;
	}
	function find(id: string) {
		return inboxAll.value.find((x) => x.id === id);
	}
	const toggleStar = (id: string) =>
		updatePref(id, { starred: !flag(id, "starred", find(id)?.starred ?? false) });
	const toggleArchive = (id: string) =>
		updatePref(id, { archived: !flag(id, "archived", find(id)?.archived ?? false) });
	const toggleMute = (id: string) =>
		updatePref(id, { muted: !flag(id, "muted", find(id)?.muted ?? false) });
	const del = (id: string) => updatePref(id, { deleted: true });
	// #endregion

	const emptyCopy = emptyStateFor(inboxView.value, inboxNarrowed.value);

	return (
		<section class="inbox" data-density={inboxDensity.value} aria-label="Conversations">
			{
				/*
				 * Mounted whether or not anything is loading: a live region has to be in the accessibility
				 * tree before its text changes, so one that arrives with its message already set is
				 * routinely never announced. The placeholder itself is decorative and stays silent.
				 */
			}
			<InboxLoadingStatus busy={skeleton.value} label="Loading conversations…" />

			{/* Error — a failed refine must never render as an empty inbox. */}
			{inboxError.value && (
				<div class="inbox__error" role="alert">
					<span class="inbox__error-icon" aria-hidden="true">
						<MessagingIcon name="mail" />
					</span>
					<div class="inbox__error-copy">
						<p class="inbox__error-title">{inboxError.value}</p>
						<p class="inbox__error-note">
							Your conversations are safe — this was a problem loading them.
						</p>
					</div>
					<Button
						label="Try again"
						variant="outlined"
						severity="secondary"
						size="sm"
						onClick={() => void apply()}
					/>
				</div>
			)}

			{/* Loading — a visible placeholder, because `aria-busy` alone is invisible to sighted viewers. */}
			{skeleton.value && !inboxError.value && <InboxListSkeleton rows={skeletonRows.value} />}

			{/* Empty — every variant teaches the action that resolves it. */}
			{!skeleton.value && !inboxError.value && rows.value.length === 0 && (
				<div class="inbox__empty">
					<span class="inbox__empty-glyph" aria-hidden="true">
						<MessagingIcon name={emptyCopy.icon} />
					</span>
					<h2 class="inbox__empty-title">{emptyCopy.title}</h2>
					<p class="inbox__empty-note">{emptyCopy.note}</p>
					<div class="inbox__empty-actions">
						{inboxNarrowed.value
							? (
								<Button
									label="Clear filters"
									variant="outlined"
									severity="secondary"
									onClick={clearInboxFilters}
								/>
							)
							: (
								<Button
									label="New message"
									icon={<MessagingIcon name="compose" />}
									onClick={openNewConversation}
								/>
							)}
					</div>
				</div>
			)}

			{/* The list. It yields to the placeholder rather than sitting under it. */}
			{!skeleton.value && rows.value.length > 0 && (
				<div class="inbox__list" aria-busy={inboxLoading.value ? "true" : undefined}>
					{groups.value.map((group) => (
						<div class="inbox__group" key={group.key}>
							{/* A lone label divides nothing — it only adds a heading above the whole list. */}
							{groups.value.length > 1 && <h2 class="inbox__group-label">{group.label}</h2>}
							{group.items.map((c) => (
								<InboxRow
									key={c.id}
									conversation={c}
									href={conversationHref(c.id)}
									active={activeId === c.id}
									compact={compact.value}
									onToggleStar={toggleStar}
									onToggleArchive={toggleArchive}
									onToggleMute={toggleMute}
									onDelete={del}
								/>
							))}
						</div>
					))}

					{/* Truncation is stated, never silent. */}
					{inboxHasMore.value && (
						<div class="inbox__more">
							<p class="inbox__more-note">
								Showing {rows.value.length} of {inboxTotal.value} conversations.
							</p>
							<Button
								label="Load more"
								variant="text"
								severity="secondary"
								size="sm"
								loading={inboxLoading.value}
								onClick={() => commitInbox()}
							/>
						</div>
					)}
				</div>
			)}
		</section>
	);
}

// #region Empty-state copy
type EmptyIcon = "inbox" | "star" | "archive" | "search";

/** The empty state branches on *why* it is empty, so its action always resolves the actual cause. */
function emptyStateFor(
	view: string,
	narrowed: boolean,
): { icon: EmptyIcon; title: string; note: string } {
	if (narrowed) {
		return {
			icon: "search",
			title: "No conversations match",
			note: "Nothing here fits the current search and filters. Clear them to see your whole inbox.",
		};
	}
	if (view === "archived") {
		return {
			icon: "archive",
			title: "Nothing archived",
			note: "Conversations you archive move here and stay out of your inbox until you need them.",
		};
	}
	if (view === "starred") {
		return {
			icon: "star",
			title: "No starred conversations",
			note: "Star a conversation from its row menu to keep it within reach here.",
		};
	}
	return {
		icon: "inbox",
		title: "No conversations yet",
		note:
			"Start one to reach a client, freelancer, team, or business. Replies land here as they arrive.",
	};
}
// #endregion
