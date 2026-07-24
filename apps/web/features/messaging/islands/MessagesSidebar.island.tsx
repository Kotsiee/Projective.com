import type { JSX, RefObject } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/messages.css";
import { Popover } from "@projective/ui/feedback";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
	type LaneToggleOption,
	LaneToggleRow,
} from "@projective/ui/navigation";
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
 * MessagesSidebar — the `/messages` inbox lane, the messaging counterpart of the `/projects` feed lane.
 * It renders BOTH presentations at once and lets CSS reveal exactly one via
 * `.ui-splitter[data-mode="collapsed"]`: an expanded stack and a collapsed {@link MessagesRail}. It
 * mounts the New Conversation + Message Settings modals (driven by the shared `messaging-state`
 * signals, so the conversation Members tab + header can open them too).
 *
 * **Chrome parity.** Every control is a shared `@projective/ui/navigation` lane primitive — the
 * {@link LaneHead}/{@link LaneFooter} bands, {@link LaneSearch}, {@link LaneIconButton},
 * {@link LaneToggleRow} (both the partition switch and the quick filters), {@link LaneList},
 * {@link LaneCollapseButton} — the
 * same components the `/projects` lane composes. Parity is therefore structural (one source of truth),
 * not a visual copy: a change to lane chrome lands on both surfaces at once.
 *
 * THIN: first paint from SSR; search + advanced facets refine through the API (`MessagingService`); the
 * conversation-state actions (Favourite · Archive · Soft-delete) + the Starred/Archived/Unread
 * partition are overlaid CLIENT-side from a persisted per-conversation preference map, so they reflect
 * instantly without a refetch. The advanced-filter SET is role-specific and live-updates from the Dev
 * Context Switcher's `messagingRole` axis.
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

/** The inbox partitions — subtle icon toggles (a single-select `ui-lane-toggles` row) rather than a
 * prominent underline tab strip, matching the non-freelancer `/projects` sidebar chrome (§B.6). */
const VIEW_TOGGLES: readonly LaneToggleOption<ConversationView>[] = [
	{ key: "inbox", label: "All", icon: <MessagingIcon name="inbox" /> },
	{ key: "starred", label: "Starred", icon: <MessagingIcon name="star" /> },
	{ key: "archived", label: "Archived", icon: <MessagingIcon name="archive" /> },
];

/** The permanent icon-only quick filters (mirrors the projects UtilityShortcuts row). */
const QUICK_TOGGLES = [
	{ key: "unread" as const, label: "Unread", icon: <MessagingIcon name="mail" /> },
	{ key: "starred" as const, label: "Starred", icon: <MessagingIcon name="star" /> },
];

type QuickKey = (typeof QUICK_TOGGLES)[number]["key"];

/** The active conversation id from the pathname (`/messages/{id}/…`), or null. */
function conversationIdFromPath(path: string): string | null {
	const segs = path.split("/").filter(Boolean);
	return segs[0] === "messages" && segs.length >= 2 ? segs[1] : null;
}

export default function MessagesSidebar(props: MessagesSidebarProps): JSX.Element {
	// Every navigation is a full page load, so the lane re-renders with a fresh `path` — the active
	// conversation is derived straight from it.
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
	const starredOnly = useSignal(false);
	const filter = useSignal<ConversationFilter>({});
	const filterOpen = useSignal(false);
	const loading = useSignal(false);
	const collapsed = useSignal(false);

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

	// #region Hydrate: prefs, saved filters, dev-seam role, lane density
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
		// Seed the collapse toggle from the splitter's persisted density (matches the projects lane).
		try {
			const el = globalThis.document?.querySelector(".ui-splitter");
			collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }
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

	// #region Derived (merge prefs → partition by view → apply quick filters)
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
		const partitioned = v === "archived"
			? merged.filter((c) => c.archived)
			: v === "starred"
			? merged.filter((c) => c.starred && !c.archived)
			: merged.filter((c) => !c.archived);
		// The quick-filter row narrows the partition further (each toggle is an AND on the visible set).
		return partitioned.filter((c) =>
			(!starredOnly.value || c.starred) && (!unread.value || c.unread)
		);
	});

	const services = useComputed(() => serviceOptions(optionSource.value));
	const products = useComputed(() => productOptions(optionSource.value));
	const entities = useComputed(() => entityOptions(optionSource.value));
	const filterCount = useComputed(() => activeFilterCount({ filter: filter.value }));
	const activeQuick = useComputed<QuickKey[]>(() => {
		const keys: QuickKey[] = [];
		if (unread.value) keys.push("unread");
		if (starredOnly.value) keys.push("starred");
		return keys;
	});
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

	/** Toggle one quick filter. `unread` is a server facet (refetch); `starred` is a local overlay. */
	function onQuick(key: QuickKey): void {
		if (key === "unread") {
			unread.value = !unread.value;
			void apply();
			return;
		}
		starredOnly.value = !starredOnly.value;
	}
	// #endregion

	/** Drive the whole middle-nav lane's width via the splitter (shared collapse event). */
	function setLaneCollapsed(next: boolean): void {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	const emptyNote = view.value === "archived"
		? "Conversations you archive are kept here."
		: view.value === "starred"
		? "Star a conversation to pin it here."
		: q.value || filterCount.value > 0 || activeQuick.value.length > 0
		? "Try clearing a filter or widening your search."
		: "Conversations you start or receive will appear here.";

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
				<LaneHead>
					<LaneBar>
						<LaneSearch
							value={q.value}
							placeholder="Search conversations"
							label="Search conversations"
							icon={<MessagingIcon name="search" />}
							onInput={onSearch}
						/>

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
									label={filterCount.value > 0
										? `Filters (${filterCount.value} active)`
										: "Filters"}
									tooltip="Filters"
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
					</LaneBar>

					<LaneToggleRow
						label="Inbox views"
						options={VIEW_TOGGLES}
						active={[view.value]}
						onToggle={(next) => (view.value = next)}
						trailing={{
							label: "Quick filters",
							options: QUICK_TOGGLES,
							active: activeQuick.value,
							onToggle: onQuick,
						}}
					/>
				</LaneHead>

				<LaneList label="Conversations" busy={loading.value}>
					{displayed.value.length === 0
						? (
							<LaneEmpty
								icon={<MessagingIcon name="inbox" />}
								title="Nothing here yet"
								note={emptyNote}
							/>
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
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setLaneCollapsed(!collapsed.value)}
					/>
					<LaneFooterActions>
						<LaneIconButton
							icon={<MessagingIcon name="settings" />}
							label="Message settings"
							tooltipPlacement="top"
							onClick={() => (settingsModalOpen.value = true)}
						/>
						<LaneIconButton
							icon={<MessagingIcon name="compose" />}
							label="New message"
							tooltipPlacement="top"
							accent
							onClick={openNewConversation}
						/>
					</LaneFooterActions>
				</LaneFooter>
			</div>

			{/* Modals (driven by the shared messaging-state signals). */}
			<NewConversationModal role={role.value} />
			<MessageSettingsModal initial={props.settings} />
		</div>
	);
}
