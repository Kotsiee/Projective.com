import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/fx-toolbar.css";
import "../styles/file-explorer.css";
import "../styles/file-card.css";
import "../styles/attachment-modal.css";
import { VirtualGrid } from "@projective/ui/display";
import { InlineNotice, Toast, useToast } from "@projective/ui/feedback";
import { FilesFrame } from "@features/files/components/FilesFrame.tsx";
import { OFFLINE_NOTICE_TEXT } from "@web/utils/offline.ts";
import { offlineOr, useOfflineStall } from "@web/utils/use-offline-stall.ts";
import { logger } from "@web/utils/logger.ts";
import type {
	AssetItem,
	ExplorerFileItem,
	FileChannelRef,
	FileKind,
	FileListPage,
	FileScope,
	FileSortDir,
	FileSortKey,
} from "../types/projects-types.ts";
import { FilesService } from "../core/FilesService.ts";
import { groupIndexOf, messageGroup } from "../core/file-model.ts";
import {
	explorerKinds,
	explorerQuery,
	explorerSortDir,
	explorerSortKey,
	explorerTitle,
	registerExplorer,
} from "../core/explorer-state.ts";
import {
	type FileChannelRoutes,
	searchWithSelection,
	selectionHref,
	selectionOfSearch,
	selectionTitle,
} from "../core/file-tree-route.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import {
	filesZoom,
	gridColWidth,
	listRowHeight,
	listShowsThumbnails,
	viewMode,
	displayZoom,
} from "../core/view-state.ts";
import { ProjectSkeleton, useSkeletonDelay } from "../components/ProjectSkeletons.tsx";
import { FileCard } from "../components/FileCard.tsx";
import { FileTable } from "../components/FileTable.tsx";
import { FileChannelTree, type FileTreeSelection } from "../components/FileChannelTree.tsx";
import { AttachmentPreviewModal } from "../components/AttachmentPreviewModal.tsx";
import { ExplorerToolbar } from "../components/ExplorerToolbar.tsx";
import { starFile } from "@features/files/core/star-file.ts";

/**
 * FileExplorer — the File Explorer workspace: the single island the `/files` routes mount, hosting the
 * project tree, the zoom-driven workspace, and the universal preview modal (one hydration boundary,
 * root CLAUDE.md §2), all drawn in the shared {@link FilesFrame} (Decision #317). The grid⇄list
 * presentation is selected by the shared {@link viewMode} (there is no toggle button); `Ctrl`+wheel over
 * the workspace drives {@link zoom} (default-prevented so the browser never page-zooms). Both viewports
 * are window-virtualized with infinite scroll.
 *
 * The tree is the project's (All files · Project files · the channels) in the frame's left panel. On
 * the project's own Files route a node scopes the workspace in place and rides in `?in=`; on a
 * channel's own Files route the same tree is drawn with the channel selected and its rows link to each
 * node's address. A conversation has one implicit room and no hierarchy, so it draws no panel.
 *
 * The toolbar (search · Attachment-Types filter · sort) is drawn ONCE: in the middle-nav header band
 * where the band is free (the project's own Files route, `ExplorerHeaderBand`), above the grid where a
 * channel or a conversation owns the band. Both write the shared `explorer-state` intent and this
 * island — the single fetch owner — re-reads.
 *
 * THIN: first paint is the SSR-resolved page; the island owns view state and refines (sort/filter/
 * search/scope/scroll-load) via the thin {@link FilesService}. Rename/star are optimistic — persistence
 * lands with the files backend behind `PROJECTS_BACKEND_LIVE`.
 */

/** The project tree as the route resolved it: the node shown, its index, and the rooms' addresses. */
export interface FileExplorerTree {
	selection: FileTreeSelection;
	routes: FileChannelRoutes;
	/** The project-scope index — on a channel's own route, the rooms the tree links between. */
	index: { channels: FileChannelRef[]; projectFileCount: number; task: boolean } | null;
}

export interface FileExplorerProps {
	/**
	 * Which space is being read. `channel`/`project` are the engagement scopes; `conversation` is the
	 * global inbox (`/messages/[conversationId]/files`) — the same explorer over a conversation's
	 * attachments, routed to `/api/messaging/files` by the shared {@link FilesService}. A conversation
	 * has a single implicit channel, so it renders the flat (tree-less) layout like channel scope.
	 */
	scope: FileScope;
	/** The project id — or, in `conversation` scope, the conversation id. */
	projectId: string;
	/** The channel id in channel scope (the conversation id in conversation scope); unused for project. */
	channelId?: string;
	initial: FileListPage | null;
	/** The project tree (project and channel scope); absent for a conversation, which draws none. */
	tree?: FileExplorerTree | null;
}

const GRID_GAP = 16;
const CARD_META = 62;
/** Placeholder extent floor/ceiling — enough to fill a viewport without drawing a whole corpus. */
const SKELETON_MIN = 8;
const SKELETON_MAX = 24;

interface WorkspaceViewProps {
	items: ExplorerFileItem[];
	isEmpty: boolean;
	hasFilters: boolean;
	/** The empty state's note when no search or filter is narrowing the list. */
	emptyNote: string;
	sortKey: Signal<string>;
	sortDir: Signal<FileSortDir>;
	onSort: (key: FileSortKey) => void;
	onOpen: (file: AssetItem) => void;
	onReachEnd: () => void;
	loadingMore: boolean;
	/** A refine has been pending long enough to be worth drawing (the delay gate, not the raw flag). */
	loading: boolean;
	/** How many placeholders to draw — the outgoing item count, so a refine redraws at that extent. */
	skeletonCount: number;
}

/**
 * WorkspaceView — the zoom-reactive body (grid ⇄ list). It reads {@link viewMode}/{@link zoom} HERE
 * (not at the island root), so a `Ctrl`+wheel / slider tick confines its re-render to the workspace —
 * the toolbar, channels tree, and the mounted preview modal are left untouched.
 *
 * The loading placeholder lives here too, for the same reason: it is built from the very expressions
 * that configure the real viewport below it (`gridColWidth(zoom)` · `listRowHeight(zoom)` ·
 * {@link GRID_GAP} · {@link CARD_META}), so a cell or a row can never be a different size than the
 * one about to replace it.
 */
function WorkspaceView(p: WorkspaceViewProps): JSX.Element {
	if (p.loading) {
		return viewMode.value === "grid"
			? (
				<ProjectSkeleton
					shape="grid"
					label="Loading files…"
					count={p.skeletonCount}
					colWidth={gridColWidth(displayZoom.value)}
					gap={GRID_GAP}
					metaHeight={CARD_META}
				/>
			)
			: (
				<ProjectSkeleton
					shape="list"
					label="Loading files…"
					count={p.skeletonCount}
					rowHeight={listRowHeight(displayZoom.value)}
					thumbnails={listShowsThumbnails(displayZoom.value)}
				/>
			);
	}
	if (p.isEmpty) {
		return (
			<div class="fx-empty" role="status">
				<p class="fx-empty__title">No files here yet</p>
				<p class="fx-empty__note">
					{p.hasFilters ? "No files match the current search and filters." : p.emptyNote}
				</p>
			</div>
		);
	}
	if (viewMode.value === "grid") {
		return (
			<VirtualGrid
				items={p.items}
				minColWidth={gridColWidth(displayZoom.value)}
				fit="exact"
				rowHeight={(w) => w + CARD_META + GRID_GAP}
				gap={GRID_GAP}
				useWindow
				overscan={3}
				onReachEnd={p.onReachEnd}
				loading={p.loadingMore}
				getItemKey={(f) => f.id}
				aria-label="Files"
				itemTemplate={(f) => <FileCard file={f} onOpen={p.onOpen} />}
			/>
		);
	}
	return (
		<FileTable
			items={p.items}
			sortKey={p.sortKey}
			sortDir={p.sortDir}
			onSort={p.onSort}
			onOpen={p.onOpen}
			onReachEnd={p.onReachEnd}
			loading={p.loadingMore}
		/>
	);
}

export default function FileExplorer(props: FileExplorerProps): JSX.Element {
	const { scope, projectId, channelId, initial } = props;
	const routes = props.tree?.routes ?? {};
	/** On a channel's own route the tree is the project's index, not the page's one-room answer. */
	const index = scope === "channel" ? props.tree?.index ?? null : null;

	// #region State
	const items = useSignal<ExplorerFileItem[]>(initial?.items ?? []);
	const channels = useSignal<FileChannelRef[]>(index?.channels ?? initial?.channels ?? []);
	const projectFileCount = useSignal<number>(
		index?.projectFileCount ?? initial?.projectFileCount ?? 0,
	);
	const cursor = useSignal<string | null>(initial?.nextCursor ?? null);
	const hasMore = useSignal<boolean>(initial?.hasMore ?? false);
	const total = useSignal<number>(initial?.total ?? 0);
	const viewerId = initial?.viewerId ?? "viewer";
	const task = index?.task ?? initial?.task ?? false;

	// The query intent is shared with the header band, where it carries the toolbar (Decision #317).
	const query = explorerQuery;
	const sortKey = explorerSortKey;
	const sortDir: Signal<FileSortDir> = explorerSortDir;
	const filterKinds = explorerKinds;
	const treeSelection = useSignal<FileTreeSelection>(props.tree?.selection ?? { kind: "all" });

	const loading = useSignal(false);
	const loadingMore = useSignal(false);
	/**
	 * The last next-page load failed while the browser was ONLINE — a fault the offline stall does
	 * not speak for. Gates `loadMore` so a reach-end trigger still in view cannot loop on a failing
	 * endpoint; only the reader's Retry (or a successful refine, which resets the list) lifts it.
	 */
	const moreFailed = useSignal(false);
	/** Mounted only when no other island has already put a stack up (they share one signal). */
	const toastMounted = useSignal(false);
	const toast = useToast();
	const openId = useSignal<string | null>(null);
	/**
	 * The placeholder gate. `loading` still drives the empty-state suppression the moment a request
	 * starts; this only decides whether the wait has been long enough to draw, so the stubbed backend
	 * (which resolves within a tick) never strobes a skeleton on every debounced keystroke.
	 */
	const skeleton = useSkeletonDelay();

	const reqId = useRef(0);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Data loading (thin refine + infinite scroll)
	function baseParams(nextCursor: string | null) {
		const sel = treeSelection.value;
		return {
			scope,
			projectId,
			channelId: scope !== "project"
				? (channelId ?? null)
				: sel.kind === "channel"
				? sel.id
				: null,
			projectFiles: scope === "project" && sel.kind === "project" ? true : undefined,
			// An empty key is the 3rd sort state ("none") — omit `sort` so the backend returns its
			// default order.
			sort: sortKey.value ? (sortKey.value as FileSortKey) : undefined,
			dir: sortDir.value,
			kinds: filterKinds.value.length ? (filterKinds.value as FileKind[]) : undefined,
			query: query.value || undefined,
			cursor: nextCursor,
		};
	}

	async function reload(): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		skeleton.begin();
		const res = await FilesService.list(baseParams(null));
		// A superseded request leaves both flags alone: the request that replaced it owns them, and
		// clearing here would drop the placeholder back to stale rows mid-flight.
		if (my !== reqId.current) return;
		loading.value = false;
		// Cleared BEFORE the payload check, so a failed refine surfaces its stale rows again rather
		// than leaving the placeholder up for the life of the page.
		skeleton.end();
		if (!res.ok || !res.data) {
			// The stale rows stay up — an empty workspace would claim there are no files — but the
			// reader is told the search, sort or filter they just chose did not apply.
			logger.error("File explorer refine failed", { scope, projectId, message: res.message });
			if (!document.querySelector(".ui-toast")) toastMounted.value = true;
			toast.show({
				severity: "danger",
				summary: offlineOr(res.message ?? "Couldn’t refresh files — showing the last results."),
				life: 6000,
			});
			return;
		}
		// A fresh first page replaces the list, so a next-page failure against the old one is moot.
		moreFailed.value = false;
		const page = res.data.page;
		items.value = page.items;
		// The tree's channel index is the project's FULL channel set. When the workspace is filtered
		// to ONE channel the backend returns only that channel's index (it infers scope from the
		// channelId), so keep the existing full index rather than collapsing the tree to the selection —
		// always on a channel's own route, whose tree is the project index the route read.
		if (scope === "project" && treeSelection.value.kind !== "channel") {
			channels.value = page.channels;
			projectFileCount.value = page.projectFileCount;
		}
		cursor.value = page.nextCursor;
		hasMore.value = page.hasMore;
		total.value = page.total;
	}

	/** Append the next page. `retry` is the reader's Retry, the one caller past a standing failure. */
	async function loadMore(retry = false): Promise<void> {
		if (
			loadingMore.value || stall.blocked.value || (moreFailed.value && !retry) || loading.value ||
			!hasMore.value || !cursor.value
		) {
			return;
		}
		const my = reqId.current;
		loadingMore.value = true;
		const res = await FilesService.list(baseParams(cursor.value));
		loadingMore.value = false;
		if (my !== reqId.current) return;
		if (res.ok && res.data) {
			items.value = [...items.value, ...res.data.page.items];
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
		}
		// An offline failure is the stall's to report; any other failure is this list's own.
		const offline = stall.settle(res.ok);
		moreFailed.value = !res.ok && !offline;
		if (moreFailed.value) {
			logger.error("File explorer next page failed", { scope, projectId, message: res.message });
		}
	}
	const stall = useOfflineStall(() => loadMore());
	// #endregion

	// #region Toolbar + tree handlers
	// The toolbar — in the header band or above the grid — writes the shared intent and asks for a
	// re-read through here; unmounting resets that intent for the next explorer in this tab.
	useEffect(() => registerExplorer(() => void reload()), []);

	// 3-state single-column sort: asc → desc → none (multi-column sort stays disabled for Files).
	function applySort(key: FileSortKey): void {
		if (sortKey.value === key) {
			if (sortDir.value === "asc") sortDir.value = "desc";
			else sortKey.value = ""; // desc → none: clear the active column (default order)
		} else {
			sortKey.value = key;
			sortDir.value = "asc";
		}
		void reload();
	}

	/**
	 * Scope the project's own Files route to a node, in place: the node rides in `?in=` (pushed, so
	 * Back walks it), the band's title follows, and the workspace re-reads.
	 */
	function onSelectNode(selection: FileTreeSelection): void {
		treeSelection.value = selection;
		explorerTitle.value = selectionTitle(selection, channels.value);
		if (typeof history !== "undefined") {
			const search = searchWithSelection(globalThis.location?.search ?? "", selection, routes);
			const href = `${globalThis.location?.pathname ?? ""}${search}`;
			if (href !== `${globalThis.location?.pathname ?? ""}${globalThis.location?.search ?? ""}`) {
				history.pushState({ filesIn: selection }, "", href);
			}
		}
		void reload();
	}

	// Back / Forward over `?in=` re-scopes without pushing a new entry.
	useEffect(() => {
		if (scope !== "project") return;
		const onPop = () => {
			const selection = selectionOfSearch(globalThis.location.search, routes);
			treeSelection.value = selection;
			explorerTitle.value = selectionTitle(selection, channels.value);
			void reload();
		};
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);
	// #endregion

	// #region Preview modal
	function open(file: AssetItem): void {
		openId.value = file.id;
	}
	function renameFile(id: string, name: string): void {
		items.value = items.value.map((f) => (f.id === id ? { ...f, name } : f));
	}
	/** Star or unstar a file the viewer owns, persisted through the saved system (Decision #180). */
	function toggleStar(id: string) {
		return starFile(items, id);
	}

	const openFile = openId.value ? items.value.find((f) => f.id === openId.value) : undefined;
	const group = openFile ? messageGroup(items.value, openFile) : [];
	const startIndex = openFile ? groupIndexOf(group, openFile) : 0;
	// #endregion

	// #region Mount effects — restore zoom + Ctrl+wheel over the workspace
	useCtrlWheelZoom(workspaceRef, filesZoom);
	// #endregion

	const isEmpty = items.value.length === 0 && !loading.value;
	const hasFilters = !!(query.value || filterKinds.value.length);

	// The zoom-reactive body is a child (WorkspaceView) — the island root deliberately does NOT read
	// zoom/viewMode, so a zoom tick re-renders only the workspace, not the toolbar/tree/modal.
	const workspaceView = (
		<WorkspaceView
			items={items.value}
			isEmpty={isEmpty}
			hasFilters={hasFilters}
			emptyNote={scope === "project" && treeSelection.value.kind === "project"
				? "Files the client attaches to the project will appear here."
				: "Attachments shared in this space will appear here."}
			sortKey={sortKey}
			sortDir={sortDir}
			onSort={applySort}
			onOpen={open}
			onReachEnd={() => void loadMore()}
			loadingMore={loadingMore.value}
			loading={skeleton.visible.value}
			skeletonCount={Math.min(Math.max(items.value.length, SKELETON_MIN), SKELETON_MAX)}
		/>
	);
	// The offline stall — or an online page failure, in the same words' place — appended under the
	// viewport in either scope's layout. The two are exclusive: `settle` decides which one a failure is.
	const stallNotice = stall.stalled.value
		? (
			<InlineNotice
				text={OFFLINE_NOTICE_TEXT}
				actionLabel="Retry"
				onAction={stall.retry}
				busy={stall.retrying.value}
			/>
		)
		: moreFailed.value
		? (
			<InlineNotice
				text="Couldn’t load more files."
				actionLabel="Retry"
				onAction={() => void loadMore(true)}
				busy={loadingMore.value}
			/>
		)
		: null;

	// A conversation is one implicit room with no hierarchy, so it draws no panel; a channel's own route
	// draws the project tree with the channel selected, its rows links to each node's address.
	const tree = scope === "conversation" ? null : (
		<FileChannelTree
			channels={channels.value}
			active={treeSelection}
			onSelect={onSelectNode}
			total={channels.value.reduce((s, c) => s + c.count, projectFileCount.value)}
			projectFileCount={projectFileCount.value}
			task={task}
			hrefOf={scope === "channel"
				? (selection) => selectionHref(projectId, selection, routes)
				: undefined}
		/>
	);

	return (
		<div class="fx-explorer" data-scope={scope}>
			<FilesFrame aside={tree} asideLabel="Project files tree">
				{
					/* The project's own route carries the toolbar in its header band; elsewhere the band is
					   the channel's or the conversation's, so the toolbar sits above the grid. */
				}
				{scope !== "project" && <ExplorerToolbar noun="files" />}
				<div class="fx-workspace" ref={workspaceRef}>
					{workspaceView}
					{stallNotice}
				</div>
			</FilesFrame>

			<AttachmentPreviewModal
				open={!!openFile}
				files={group}
				startIndex={startIndex}
				viewerId={viewerId}
				projectId={projectId}
				onClose={() => (openId.value = null)}
				onRename={renameFile}
				onToggleStar={toggleStar}
				context={scope === "conversation"
					? { kind: "messages", conversationId: projectId }
					: { kind: "project", projectSlug: projectId }}
			/>

			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</div>
	);
}
