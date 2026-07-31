import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/inbox.css";
import { LaneCollapseButton, LaneFooter, LaneList } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { MessagingIcon, type MessagingIconName } from "../components/messaging-glyphs.tsx";
import { MessagesRail } from "../components/MessagesRail.tsx";
import { NewConversationModal } from "../components/NewConversationModal.tsx";
import { MessageSettingsModal } from "../components/MessageSettingsModal.tsx";
import { relationFacetsForRole } from "../core/conversation-filters.ts";
import { RELATION_LABEL } from "../core/conversation-model.ts";
import { openNewConversation } from "../core/messaging-state.ts";
import {
	commitInbox,
	inboxCounts,
	inboxMerged,
	inboxRelation,
	inboxRole,
	inboxUnreadOnly,
	inboxView,
	relationCounts,
} from "../core/inbox-state.ts";
import type {
	ConversationRelation,
	ConversationView,
	MessagingRole,
	MessagingSettings,
} from "../types/messaging-types.ts";

/**
 * InboxScopeLane — the `/messages` ROOT lane. It owns **navigation and scope only**: which slice of the
 * inbox the body is showing, and which relationship it is filtered to. The conversations themselves
 * live in the body ({@link InboxView}), where they have the width to be read.
 *
 * This replaces five unlabelled icon toggles (two of which were the same glyph with the same label)
 * with named rows carrying **live counts** — the lane's 280px spent on the one job it is good at:
 * telling you where you are and how much is there. Counts come from `inbox-state`'s merged set, so an
 * optimistic star or archive in the body moves them immediately.
 *
 * Beside an OPEN conversation the lane is the conversation list instead ({@link MessagesSidebar}) —
 * navigation among siblings, which is what a lane is for. This component is the root's scope map.
 */

// #region Props
export interface InboxScopeLaneProps {
	/** SSR messaging-view baseline — seeds the relation facet set before hydration. */
	role: MessagingRole;
	/** The Message Settings projection (seeds the settings modal this lane mounts). */
	settings: MessagingSettings;
}

interface ViewRow {
	key: ConversationView | "unread";
	label: string;
	icon: MessagingIconName;
	count: number;
}
// #endregion

export default function InboxScopeLane(props: InboxScopeLaneProps): JSX.Element {
	const collapsed = useSignal(false);

	useEffect(() => {
		if (inboxRole.value !== props.role) inboxRole.value = props.role;
		try {
			const el = globalThis.document?.querySelector(".ui-splitter");
			collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }
	}, []);

	function setLaneCollapsed(next: boolean): void {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR — non-fatal */ }
	}

	// #region Scope model
	const views = useComputed<ViewRow[]>(() => {
		const c = inboxCounts.value;
		return [
			{ key: "inbox", label: "All conversations", icon: "inbox", count: c.inbox },
			{ key: "unread", label: "Unread", icon: "mail", count: c.unread },
			{ key: "starred", label: "Starred", icon: "star", count: c.starred },
			{ key: "archived", label: "Archived", icon: "archive", count: c.archived },
		];
	});

	/** A view row is active when its partition is selected — Unread is a narrowing of All, not a slice. */
	function viewActive(key: ViewRow["key"]): boolean {
		if (key === "unread") return inboxUnreadOnly.value;
		return inboxView.value === key && !inboxUnreadOnly.value;
	}

	function selectView(key: ViewRow["key"]): void {
		if (key === "unread") {
			inboxUnreadOnly.value = !inboxUnreadOnly.value;
			if (inboxUnreadOnly.value) inboxView.value = "inbox";
		} else {
			inboxView.value = key as ConversationView;
			inboxUnreadOnly.value = false;
		}
		commitInbox();
	}

	// Only offer a relation facet that actually has conversations behind it in the current partition.
	const relations = useComputed(() => {
		const counts = relationCounts.value;
		return relationFacetsForRole(inboxRole.value)
			.map((f) => ({ ...f, count: counts[f.relation] ?? 0 }))
			.filter((f) => f.count > 0);
	});

	function selectRelation(relation: ConversationRelation | null): void {
		inboxRelation.value = inboxRelation.value === relation ? null : relation;
		commitInbox();
	}
	// #endregion

	return (
		<div class="msg-sidebar" data-role={inboxRole.value}>
			{/* Collapsed rail — CSS reveals it only at the narrow density. */}
			<MessagesRail
				recent={inboxMerged.value.slice(0, 8)}
				activeId={null}
				onNew={openNewConversation}
				onSettings={() => {/* settings live in the footer band at this density */}}
				onExpand={() => setLaneCollapsed(false)}
			/>

			<div class="msg-sidebar__full">
				<LaneList label="Inbox scope" class="inbox-scope">
					<nav class="inbox-scope__group" aria-label="Inbox views">
						{views.value.map((v) => (
							<button
								key={v.key}
								type="button"
								class="inbox-scope__row"
								data-active={viewActive(v.key) ? "true" : undefined}
								aria-pressed={viewActive(v.key)}
								onClick={() => selectView(v.key)}
							>
								<span class="inbox-scope__icon" aria-hidden="true">
									<MessagingIcon name={v.icon} />
								</span>
								<span class="inbox-scope__label">{v.label}</span>
								<span class="inbox-scope__count">{v.count}</span>
							</button>
						))}
					</nav>

					{relations.value.length > 0 && (
						<nav class="inbox-scope__group" aria-label="Filter by relationship">
							<h2 class="inbox-scope__heading">Relationship</h2>
							{relations.value.map((f) => (
								<button
									key={f.relation}
									type="button"
									class="inbox-scope__row"
									data-active={inboxRelation.value === f.relation ? "true" : undefined}
									aria-pressed={inboxRelation.value === f.relation}
									onClick={() => selectRelation(f.relation)}
								>
									<span class="inbox-scope__label">{f.label}</span>
									<span class="inbox-scope__count">{f.count}</span>
								</button>
							))}
							{inboxRelation.value && (
								<button
									type="button"
									class="inbox-scope__clear"
									onClick={() => selectRelation(null)}
								>
									Clear {RELATION_LABEL[inboxRelation.value].toLowerCase()} filter
								</button>
							)}
						</nav>
					)}
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setLaneCollapsed(!collapsed.value)}
					/>
				</LaneFooter>
			</div>

			{/* Modals (driven by the shared messaging-state signals; triggered from the footer band). */}
			<NewConversationModal role={inboxRole.value} />
			<MessageSettingsModal initial={props.settings} />
		</div>
	);
}
