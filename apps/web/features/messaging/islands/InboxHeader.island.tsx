import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/inbox.css";
import { LaneFilterPopover, TabStrip, type TabStripItem } from "@projective/ui/navigation";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { MessagesFilterPanel } from "../components/MessagesFilterPanel.tsx";
import {
	activeFilterCount,
	CONVERSATION_SORT_OPTIONS,
	DEFAULT_CONVERSATION_SORT,
	defaultConversationSortDir,
	entityOptions,
	isDefaultConversationSort,
	productOptions,
	serviceOptions,
} from "../core/conversation-filters.ts";
import { RELATION_LABEL } from "../core/conversation-model.ts";
import {
	clearInboxFilters,
	commitInbox,
	inboxAll,
	inboxFilter,
	inboxFolder,
	inboxLoading,
	inboxMerged,
	inboxNarrowed,
	inboxQuery,
	inboxRelation,
	inboxRole,
	inboxSeeded,
	inboxSort,
	inboxSortDir,
	inboxUnreadOnly,
	inboxView,
	visibleConversations,
} from "../core/inbox-state.ts";
import {
	folderUnreadCounts,
	INBOX_FOLDER_LABELS,
	INBOX_FOLDERS,
	type InboxFolder,
	type MessagingRole,
} from "../types/messaging-types.ts";

/**
 * InboxHeader — the `/messages` ROOT header band: **identity and global controls**, per the region
 * contract. It carries the surface's name, an honest live count of what the body is showing, the
 * free-text search, the id-based refinements (service · product · team/business) that are too long
 * to live as lane rows, and the folder tabs (Primary · Requests · Archived) the lane carries on desktop.
 * The tabs take the centre slot every middle-nav header gives its {@link TabStrip}, so they collapse to
 * the same stepped dropdown when the band narrows.
 *
 * The root had **no header band at all** before this — `conversationHeaderFor` returned `null` off a
 * specific conversation — which is why search and filters had piled into the lane head.
 *
 * Dumb: it writes intent into `inbox-state` and calls `commitInbox()`. The body owns every fetch.
 */

// #region Props
export interface InboxHeaderProps {
	/** SSR messaging-view baseline (the filter panel's facet set depends on it). */
	role: MessagingRole;
	/** SSR conversation count — the first-paint value before the body publishes its own. */
	initialCount: number;
}
// #endregion

const SEARCH_SETTLE_MS = 220;

export default function InboxHeader(props: InboxHeaderProps): JSX.Element {
	const filterOpen = useSignal(false);
	const searchTimer = useRef<number | null>(null);

	const services = useComputed(() => serviceOptions(inboxAll.value));
	const products = useComputed(() => productOptions(inboxAll.value));
	const entities = useComputed(() => entityOptions(inboxAll.value));
	const filterCount = useComputed(() =>
		activeFilterCount({ filter: inboxFilter.value }) +
		(isDefaultConversationSort(inboxSort.value, inboxSortDir.value) ? 0 : 1)
	);

	function resetFilters(): void {
		inboxFilter.value = {};
		inboxSort.value = DEFAULT_CONVERSATION_SORT;
		inboxSortDir.value = defaultConversationSortDir(DEFAULT_CONVERSATION_SORT);
		commitInbox();
	}

	/**
	 * What the body is actually showing. DERIVED from the same shared signals the body renders from,
	 * via the same pure function — not read from a signal the body publishes, which left this count
	 * one interaction behind the list it describes.
	 */
	const shown = useComputed(() =>
		inboxSeeded.value ? visibleConversations().length : props.initialCount
	);

	/**
	 * Search commits the same way every other control does: write the intent, then ask the body to
	 * re-run its query. Relying on the body to notice the signal instead made this the one control
	 * on the surface with its own mechanism — and the one that silently stopped working.
	 */
	function onSearch(value: string): void {
		inboxQuery.value = value;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(commitInbox, SEARCH_SETTLE_MS) as unknown as number;
	}

	const unreadByFolder = useComputed(() => folderUnreadCounts(inboxMerged.value));
	const folderTabs = useComputed<TabStripItem<InboxFolder>[]>(() =>
		INBOX_FOLDERS.map((f) => {
			const count = f === "requests" ? unreadByFolder.value.requests : 0;
			return {
				key: f,
				label: INBOX_FOLDER_LABELS[f],
				dot: count > 0,
				hint: count > 0 ? `${count} unread` : undefined,
			};
		})
	);

	/** The active scope, said in words, so the header explains the count rather than just printing it. */
	const scopeLabel = useComputed(() => {
		const parts: string[] = [];
		if (inboxFolder.value !== "primary") {
			parts.push(INBOX_FOLDER_LABELS[inboxFolder.value].toLowerCase());
		}
		if (inboxUnreadOnly.value) parts.push("unread");
		else if (inboxView.value === "starred") parts.push("starred");
		if (inboxRelation.value) parts.push(RELATION_LABEL[inboxRelation.value].toLowerCase());
		return parts.join(" · ");
	});

	return (
		<header class="inbox-head">
			<div class="inbox-head__identity">
				<h1 class="inbox-head__title">Messages</h1>
				<p class="inbox-head__count" aria-live="polite">
					{inboxLoading.value ? "Loading…" : (
						<>
							{shown.value} {shown.value === 1 ? "conversation" : "conversations"}
							{scopeLabel.value && <span class="inbox-head__scope">{scopeLabel.value}</span>}
						</>
					)}
				</p>
			</div>

			<TabStrip<InboxFolder>
				tone="header"
				label="Inbox folders"
				class="inbox-head__folders"
				activeKey={inboxFolder.value}
				items={folderTabs.value}
				onSelect={(next) => (inboxFolder.value = next)}
			/>

			<div class="inbox-head__controls">
				<div class="inbox-head__search">
					<span class="inbox-head__search-icon" aria-hidden="true">
						<MessagingIcon name="search" />
					</span>
					<input
						type="search"
						class="inbox-head__search-input"
						value={inboxQuery.value}
						placeholder="Search conversations"
						aria-label="Search conversations"
						onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
					/>
				</div>

				<LaneFilterPopover
					open={filterOpen}
					active={filterCount.value}
					icon={<MessagingIcon name="filter" />}
					onReset={resetFilters}
					sort={{
						options: CONVERSATION_SORT_OPTIONS,
						value: inboxSort.value,
						direction: inboxSortDir.value,
						onSort: (next) => {
							if (next === inboxSort.value) return;
							inboxSort.value = next;
							inboxSortDir.value = defaultConversationSortDir(next);
							commitInbox();
						},
						onDirection: (next) => {
							inboxSortDir.value = next;
							commitInbox();
						},
					}}
				>
					<MessagesFilterPanel
						role={inboxRole.value || props.role}
						params={{ filter: inboxFilter.value }}
						services={services.value}
						products={products.value}
						entities={entities.value}
						onApply={(next) => {
							inboxFilter.value = next.filter ?? {};
							commitInbox();
						}}
					/>
				</LaneFilterPopover>

				{inboxNarrowed.value && (
					<button type="button" class="inbox-head__clear" onClick={clearInboxFilters}>
						Clear
					</button>
				)}
			</div>
		</header>
	);
}
