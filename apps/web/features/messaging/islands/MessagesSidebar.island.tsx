import type { JSX, RefObject } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/messages.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { ConversationRow } from "../components/ConversationRow.tsx";
import { MessagesFilterPanel } from "../components/MessagesFilterPanel.tsx";
import { MessagesRail } from "../components/MessagesRail.tsx";
import { NewConversationModal } from "../components/NewConversationModal.tsx";
import { MessageSettingsModal } from "../components/MessageSettingsModal.tsx";
import { MessagingService } from "../core/MessagingService.ts";
import { conversationHref } from "../core/conversation-model.ts";
import { openNewConversation, settingsModalOpen } from "../core/messaging-state.ts";
import { liveMessagingRole, readDevSeam, subscribeDevSeam } from "../core/messaging-view.ts";
import {
	activeFilterCount,
	entityOptions,
	productOptions,
	serviceOptions,
} from "../core/conversation-filters.ts";
import type {
	ConversationFilter,
	ConversationListPage,
	ConversationSummary,
	ConversationView,
	MessagingRole,
	MessagingSettings,
} from "../types/messaging-types.ts";

/**
 * MessagesSidebar — the `/messages` inbox lane (task §2A), the messaging counterpart of `ProjectSidebar`.
 * It renders BOTH presentations at once and lets CSS reveal exactly one via
 * `.ui-splitter[data-mode="collapsed"]`: an expanded stack (title + New/Settings · search · advanced
 * filter popover · Starred/Archived/Unread quick filters · the conversation list) and a collapsed
 * {@link MessagesRail}. It mounts the New Conversation + Message Settings modals (driven by the shared
 * `messaging-state` signals, so the conversation Members tab + header can open them too).
 *
 * THIN: first paint from SSR; search + advanced facets refine through the API (`MessagingService`); the
 * conversation-state actions (Favourite · Archive · Soft-delete, task §2A) + the Starred/Archived/Unread
 * partition are overlaid CLIENT-side from a persisted per-conversation preference map, so they reflect
 * instantly without a refetch. The advanced-filter SET is role-specific and live-updates from the Dev
 * Context Switcher's `messagingRole` axis (task §4).
 */

// #region Props
export interface MessagesSidebarProps {
	initial: ConversationListPage;
	/** The SSR messaging-view baseline (freelancer/client/business). */
	role: MessagingRole;
	/** SSR pathname — seeds the active conversation highlight. */
	path: string;
	/** The SSR Message Settings projection (seeds the settings modal). */
	settings: MessagingSettings;
}

/** Local per-conversation state overrides. */
interface ConvPref {
	starred?: boolean;
	archived?: boolean;
	muted?: boolean;
	deleted?: boolean;
}
// #endregion

const SEARCH_DEBOUNCE_MS = 220;
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

/** The active conversation id from the pathname (`/messages/{id}/…`), or null. */
function conversationIdFromPath(path: string): string | null {
	const segs = path.split("/").filter(Boolean);
	return segs[0] === "messages" && segs.length >= 2 ? segs[1] : null;
}

export default function MessagesSidebar(props: MessagesSidebarProps): JSX.Element {
	const activeId = conversationIdFromPath(props.path);

	// #region State
	const role = useSignal<MessagingRole>(props.role);
	const serverList = useSignal<ConversationSummary[]>(props.initial.conversations);
	// The unfiltered full set — the source for the advanced-filter option lists (services/products/…).
	const optionSource = useSignal<ConversationSummary[]>(props.initial.conversations);
	const prefs = useSignal<Record<string, ConvPref>>({});
	const view = useSignal<ConversationView>("inbox");
	const q = useSignal("");
	const unread = useSignal(false);
	const filter = useSignal<ConversationFilter>({});
	const filterOpen = useSignal(false);
	const loading = useSignal(false);

	const searchTimer = useRef<number | null>(null);
	const reqId = useRef(0);
	// #endregion

	// #region Fetch + refine
	async function apply(): Promise<void> {
		const id = ++reqId.current;
		loading.value = true;
		const res = await MessagingService.conversations({
			q: q.value || undefined,
			role: role.value,
			unread: unread.value || undefined,
			filter: activeFilterCount({ filter: filter.value }) > 0 ? filter.value : undefined,
		});
		if (id !== reqId.current) return; // a newer request superseded this one
		loading.value = false;
		if (res.ok && res.data) serverList.value = res.data.page.conversations;
		persistFilters();
	}

	function persistFilters(): void {
		writeStored(
			"local",
			LocalKeys.MESSAGES_FILTERS,
			JSON.stringify({ q: q.value, view: view.value, unread: unread.value, filter: filter.value }),
		);
	}

	function onSearch(value: string): void {
		q.value = value;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => void apply(), SEARCH_DEBOUNCE_MS) as unknown as number;
	}
	// #endregion

	// #region Hydrate: prefs, saved filters, dev-seam role
	useEffect(() => {
		// Per-conversation prefs.
		const rawPrefs = readStored("local", LocalKeys.CONVERSATION_PREFS);
		if (rawPrefs) {
			try {
				prefs.value = JSON.parse(rawPrefs) as Record<string, ConvPref>;
			} catch { /* corrupt — ignore */ }
		}
		// Saved filter continuity.
		const rawFilters = readStored("local", LocalKeys.MESSAGES_FILTERS);
		if (rawFilters) {
			try {
				const saved = JSON.parse(rawFilters) as {
					q?: string;
					view?: ConversationView;
					unread?: boolean;
					filter?: ConversationFilter;
				};
				if (saved.q) q.value = saved.q;
				if (saved.view) view.value = saved.view;
				if (saved.unread) unread.value = saved.unread;
				if (saved.filter) filter.value = saved.filter;
			} catch { /* ignore */ }
		}
		// Dev-seam messaging-view override + live subscription.
		const recompute = () => {
			const next = liveMessagingRole(props.role, readDevSeam());
			if (next !== role.value) {
				role.value = next;
				void apply();
			}
		};
		recompute();
		const unsub = subscribeDevSeam(recompute);
		// Refetch once with any restored filters.
		if (rawFilters) void apply();
		return unsub;
	}, []);
	// #endregion

	// #region Derived (merge prefs → partition by view)
	const displayed = useComputed<ConversationSummary[]>(() => {
		const p = prefs.value;
		const merged = serverList.value
			.filter((c) => !p[c.id]?.deleted)
			.map((c) => ({
				...c,
				starred: p[c.id]?.starred ?? c.starred,
				archived: p[c.id]?.archived ?? c.archived,
				muted: p[c.id]?.muted ?? c.muted,
			}));
		const v = view.value;
		if (v === "archived") return merged.filter((c) => c.archived);
		if (v === "starred") return merged.filter((c) => c.starred && !c.archived);
		return merged.filter((c) => !c.archived);
	});

	const services = useComputed(() => serviceOptions(optionSource.value));
	const products = useComputed(() => productOptions(optionSource.value));
	const entities = useComputed(() => entityOptions(optionSource.value));
	const filterCount = useComputed(() => activeFilterCount({ filter: filter.value }));
	// #endregion

	// #region Conversation-state actions (optimistic, persisted locally)
	function mergedFlag(id: string, key: keyof ConvPref, base: boolean): boolean {
		return prefs.value[id]?.[key] ?? base;
	}
	function updatePref(id: string, patch: ConvPref): void {
		const next = { ...prefs.value, [id]: { ...prefs.value[id], ...patch } };
		prefs.value = next;
		writeStored("local", LocalKeys.CONVERSATION_PREFS, JSON.stringify(next));
	}
	function toggleStar(id: string): void {
		const c = serverList.value.find((x) => x.id === id);
		updatePref(id, { starred: !mergedFlag(id, "starred", c?.starred ?? false) });
	}
	function toggleArchive(id: string): void {
		const c = serverList.value.find((x) => x.id === id);
		updatePref(id, { archived: !mergedFlag(id, "archived", c?.archived ?? false) });
	}
	function del(id: string): void {
		updatePref(id, { deleted: true });
	}
	// #endregion

	function setLaneCollapsed(next: boolean): void {
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	const VIEWS: Array<{ key: ConversationView; label: string }> = [
		{ key: "inbox", label: "All" },
		{ key: "starred", label: "Starred" },
		{ key: "archived", label: "Archived" },
	];

	return (
		<div class="msg-sidebar" data-role={role.value}>
			{/* Collapsed rail — CSS reveals it only at the narrow density. */}
			<MessagesRail
				recent={displayed.value.slice(0, 8)}
				activeId={activeId}
				onNew={openNewConversation}
				onSettings={() => (settingsModalOpen.value = true)}
				onExpand={() => setLaneCollapsed(false)}
			/>

			{/* Expanded stack. */}
			<div class="msg-sidebar__full">
				<header class="msg-sidebar__header">
					<div class="msg-sidebar__titlerow">
						<h2 class="msg-sidebar__title">Messages</h2>
						<div class="msg-sidebar__head-actions">
							<Tooltip content="New message" placement="bottom">
								<button
									type="button"
									class="msg-iconbtn msg-iconbtn--accent"
									aria-label="New message"
									onClick={openNewConversation}
								>
									<MessagingIcon name="compose" />
								</button>
							</Tooltip>
							<Tooltip content="Message settings" placement="bottom">
								<button
									type="button"
									class="msg-iconbtn"
									aria-label="Message settings"
									onClick={() => (settingsModalOpen.value = true)}
								>
									<MessagingIcon name="settings" />
								</button>
							</Tooltip>
						</div>
					</div>

					<div class="msg-sidebar__searchrow">
						<div class="msg-sidebar__search">
							<span class="msg-sidebar__search-icon" aria-hidden="true">
								<MessagingIcon name="search" />
							</span>
							<input
								type="search"
								class="msg-sidebar__search-input"
								placeholder="Search conversations…"
								value={q.value}
								aria-label="Search conversations"
								onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
							/>
						</div>
						<Popover
							open={filterOpen}
							placement="bottom-end"
							avoid={SHELL_AVOID}
							class="msg-filter-pop"
							trigger={(api) => (
								<Tooltip content="Filters" placement="bottom">
									<button
										type="button"
										ref={api.ref as RefObject<HTMLButtonElement>}
										class="msg-iconbtn"
										data-on={filterCount.value > 0 ? "true" : undefined}
										aria-label={filterCount.value > 0
											? `Filters (${filterCount.value} active)`
											: "Filters"}
										aria-haspopup="dialog"
										aria-expanded={api.expanded}
										aria-controls={api.panelId}
										onClick={api.toggle}
									>
										<MessagingIcon name="filter" />
										{filterCount.value > 0 && <span class="msg-iconbtn__dot" aria-hidden="true" />}
									</button>
								</Tooltip>
							)}
						>
							<MessagesFilterPanel
								role={role.value}
								params={{ filter: filter.value }}
								services={services.value}
								products={products.value}
								entities={entities.value}
								onApply={(next) => {
									filter.value = next.filter ?? {};
									void apply();
								}}
								onReset={() => {
									filter.value = {};
									void apply();
								}}
							/>
						</Popover>
					</div>

					<div class="msg-sidebar__quickfilters">
						<div class="msg-viewseg" role="radiogroup" aria-label="Conversation view">
							{VIEWS.map((v) => (
								<button
									key={v.key}
									type="button"
									role="radio"
									aria-checked={view.value === v.key}
									class="msg-viewseg__opt"
									data-on={view.value === v.key ? "true" : undefined}
									onClick={() => (view.value = v.key)}
								>
									{v.label}
								</button>
							))}
						</div>
						<Tooltip
							content={unread.value ? "Showing unread" : "Show unread only"}
							placement="bottom"
						>
							<button
								type="button"
								class="msg-iconbtn msg-iconbtn--sm"
								data-on={unread.value ? "true" : undefined}
								aria-pressed={unread.value}
								aria-label="Unread only"
								onClick={() => {
									unread.value = !unread.value;
									void apply();
								}}
							>
								<MessagingIcon name="bell" />
							</button>
						</Tooltip>
					</div>
				</header>

				<div class="msg-sidebar__list" role="list" aria-busy={loading.value}>
					{displayed.value.length === 0
						? (
							<div class="msg-sidebar__empty">
								<span class="msg-sidebar__empty-glyph" aria-hidden="true">
									<MessagingIcon name="inbox" />
								</span>
								<p class="msg-sidebar__empty-text">
									{view.value === "archived"
										? "No archived conversations."
										: view.value === "starred"
										? "No starred conversations yet."
										: q.value || filterCount.value > 0
										? "No conversations match your filters."
										: "No conversations yet."}
								</p>
							</div>
						)
						: (
							displayed.value.map((c) => (
								<ConversationRow
									key={c.id}
									conversation={c}
									href={conversationHref(c.id)}
									active={activeId === c.id}
									onToggleStar={toggleStar}
									onToggleArchive={toggleArchive}
									onDelete={del}
								/>
							))
						)}
				</div>

				<footer class="msg-sidebar__footer">
					<Tooltip content="Collapse lane" placement="top">
						<button
							type="button"
							class="msg-sidebar__collapse"
							aria-label="Collapse lane"
							aria-pressed={false}
							onClick={() => setLaneCollapsed(true)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
					<div class="msg-sidebar__footer-actions">
						<Tooltip content="New message" placement="top">
							<button
								type="button"
								class="msg-iconbtn msg-iconbtn--accent"
								aria-label="New message"
								onClick={openNewConversation}
							>
								<MessagingIcon name="compose" />
							</button>
						</Tooltip>
					</div>
				</footer>
			</div>

			{/* Modals (driven by the shared messaging-state signals). */}
			<NewConversationModal role={role.value} />
			<MessageSettingsModal initial={props.settings} />
		</div>
	);
}
