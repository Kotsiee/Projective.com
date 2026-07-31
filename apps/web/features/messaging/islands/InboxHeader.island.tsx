import type { JSX, RefObject } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/inbox.css";
import { Popover } from "@projective/ui/feedback";
import { LaneIconButton } from "@projective/ui/navigation";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { MessagesFilterPanel } from "../components/MessagesFilterPanel.tsx";
import {
	activeFilterCount,
	entityOptions,
	productOptions,
	serviceOptions,
} from "../core/conversation-filters.ts";
import { RELATION_LABEL } from "../core/conversation-model.ts";
import {
	clearInboxFilters,
	commitInbox,
	inboxAll,
	inboxFilter,
	inboxLoading,
	inboxNarrowed,
	inboxQuery,
	inboxRelation,
	inboxRole,
	inboxSeeded,
	inboxUnreadOnly,
	inboxView,
	visibleConversations,
} from "../core/inbox-state.ts";
import type { MessagingRole } from "../types/messaging-types.ts";

/**
 * InboxHeader — the `/messages` ROOT header band: **identity and global controls**, per the region
 * contract. It carries the surface's name, an honest live count of what the body is showing, the
 * free-text search, and the id-based refinements (service · product · team/business) that are too
 * long to live as lane rows.
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

const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;
const SEARCH_SETTLE_MS = 220;

export default function InboxHeader(props: InboxHeaderProps): JSX.Element {
	const filterOpen = useSignal(false);
	const searchTimer = useRef<number | null>(null);

	const services = useComputed(() => serviceOptions(inboxAll.value));
	const products = useComputed(() => productOptions(inboxAll.value));
	const entities = useComputed(() => entityOptions(inboxAll.value));
	const filterCount = useComputed(() => activeFilterCount({ filter: inboxFilter.value }));

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

	/** The active scope, said in words, so the header explains the count rather than just printing it. */
	const scopeLabel = useComputed(() => {
		const parts: string[] = [];
		if (inboxUnreadOnly.value) parts.push("unread");
		else if (inboxView.value === "starred") parts.push("starred");
		else if (inboxView.value === "archived") parts.push("archived");
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

				<Popover
					open={filterOpen}
					placement="bottom-end"
					avoid={SHELL_AVOID}
					allowOverflow={["bottom"]}
					class="msg-filter-pop"
					trigger={(api) => (
						<LaneIconButton
							triggerRef={api.ref as RefObject<HTMLElement>}
							icon={<MessagingIcon name="filter" />}
							label={filterCount.value > 0 ? `Filters (${filterCount.value} active)` : "Filters"}
							tooltip="Refine by service, product or team"
							active={filterCount.value > 0}
							dot={filterCount.value > 0}
							ariaHasPopup="dialog"
							ariaExpanded={api.expanded}
							ariaControls={api.panelId}
							onClick={api.toggle}
						/>
					)}
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
						onReset={() => {
							inboxFilter.value = {};
							commitInbox();
						}}
					/>
				</Popover>

				{inboxNarrowed.value && (
					<button type="button" class="inbox-head__clear" onClick={clearInboxFilters}>
						Clear
					</button>
				)}
			</div>
		</header>
	);
}
