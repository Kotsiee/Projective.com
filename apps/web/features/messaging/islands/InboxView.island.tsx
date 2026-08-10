import type { JSX } from "preact";
import { useComputed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/inbox.css";
import { Button } from "@projective/ui/fields";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { InboxRow } from "../components/InboxRow.tsx";
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
	async function apply(): Promise<void> {
		const id = ++reqId.current;
		inboxLoading.value = true;
		inboxError.value = null;

		const relations = inboxRelation.value ? [inboxRelation.value] : undefined;
		const res = await MessagingService.conversations({
			q: inboxQuery.value || undefined,
			role: inboxRole.value,
			unread: inboxUnreadOnly.value || undefined,
			filter: relations ? { ...inboxFilter.value, relations } : inboxFilter.value,
		});

		if (id !== reqId.current) return; // superseded by a newer request
		inboxLoading.value = false;

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

			{/* Loading — a visible skeleton, because `aria-busy` alone is invisible to sighted viewers. */}
			{inboxLoading.value && rows.value.length === 0 && !inboxError.value && (
				<div class="inbox__skeleton" aria-hidden="true">
					{[0, 1, 2, 3, 4, 5].map((i) => (
						<div key={i} class="inbox__skel-row">
							<span class="inbox__skel-avatar" />
							<span class="inbox__skel-lines">
								<span class="inbox__skel-line inbox__skel-line--name" />
								<span class="inbox__skel-line inbox__skel-line--preview" />
							</span>
						</div>
					))}
				</div>
			)}

			{/* Empty — every variant teaches the action that resolves it. */}
			{!inboxLoading.value && !inboxError.value && rows.value.length === 0 && (
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

			{/* The list. */}
			{rows.value.length > 0 && (
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
