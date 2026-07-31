import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/fx-toolbar.css";
import "../styles/file-explorer.css";
import "../styles/file-card.css";
import "../styles/file-table.css";
import "../styles/attachment-modal.css";
import { VirtualGrid } from "@projective/ui/display";
import { InputText, MultiSelect, SortControl } from "@projective/ui/fields";
import type {
	FileChannelRef,
	FileItem,
	FileKind,
	FileListPage,
	FileScope,
	FileSortDir,
	FileSortKey,
} from "../types/projects-types.ts";
import { FilesService } from "../core/FilesService.ts";
import {
	FILE_KIND_OPTIONS,
	FILE_SORT_OPTIONS,
	groupIndexOf,
	messageGroup,
} from "../core/file-model.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { filesZoom, gridColWidth, viewMode, zoom } from "../core/view-state.ts";
import { FileCard } from "../components/FileCard.tsx";
import { FileTable } from "../components/FileTable.tsx";
import { FileChannelTree } from "../components/FileChannelTree.tsx";
import { AttachmentPreviewModal } from "../components/AttachmentPreviewModal.tsx";
import { SearchIcon } from "../components/file-glyphs.tsx";

/**
 * FileExplorer — the File Explorer workspace: the single island the `/files` routes mount, hosting the
 * toolbar (borderless search · Attachment-Types filter · SortControl), the zoom-driven workspace, and
 * the universal preview modal (one hydration boundary, root CLAUDE.md §2). The grid⇄list presentation
 * is selected by the shared {@link viewMode} (there is no toggle button); `Ctrl`+wheel over the
 * workspace drives {@link zoom} (default-prevented so the browser never page-zooms). Both viewports are
 * window-virtualized with infinite scroll. Project scope prepends the {@link FileChannelTree} navigator.
 *
 * THIN: first paint is the SSR-resolved page; the island owns view state and refines (sort/filter/
 * search/scope/scroll-load) via the thin {@link FilesService}. Rename/star are optimistic — persistence
 * lands with the files backend behind `PROJECTS_BACKEND_LIVE`.
 */
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
}

const GRID_GAP = 16;
const CARD_META = 62;

interface WorkspaceViewProps {
	items: FileItem[];
	isEmpty: boolean;
	hasFilters: boolean;
	sortKey: Signal<string>;
	sortDir: Signal<FileSortDir>;
	onSort: (key: FileSortKey) => void;
	onOpen: (file: FileItem) => void;
	onReachEnd: () => void;
	loadingMore: boolean;
}

/**
 * WorkspaceView — the zoom-reactive body (grid ⇄ list). It reads {@link viewMode}/{@link zoom} HERE
 * (not at the island root), so a `Ctrl`+wheel / slider tick confines its re-render to the workspace —
 * the toolbar, channels tree, and the mounted preview modal are left untouched.
 */
function WorkspaceView(p: WorkspaceViewProps): JSX.Element {
	if (p.isEmpty) {
		return (
			<div class="fx-empty" role="status">
				<p class="fx-empty__title">No files here yet</p>
				<p class="fx-empty__note">
					{p.hasFilters
						? "No files match the current search and filters."
						: "Attachments shared in this space will appear here."}
				</p>
			</div>
		);
	}
	if (viewMode.value === "grid") {
		return (
			<VirtualGrid
				items={p.items}
				minColWidth={gridColWidth(zoom.value)}
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

	// #region State
	const items = useSignal<FileItem[]>(initial?.items ?? []);
	const channels = useSignal<FileChannelRef[]>(initial?.channels ?? []);
	const cursor = useSignal<string | null>(initial?.nextCursor ?? null);
	const hasMore = useSignal<boolean>(initial?.hasMore ?? false);
	const total = useSignal<number>(initial?.total ?? 0);
	const viewerId = initial?.viewerId ?? "viewer";

	const query = useSignal("");
	const sortKey = useSignal<string>("date");
	const sortDir = useSignal<FileSortDir>("desc");
	const filterKinds = useSignal<string[]>([]);
	const activeChannel = useSignal<string | null>(null);

	const loading = useSignal(false);
	const loadingMore = useSignal(false);
	const openId = useSignal<string | null>(null);

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Data loading (thin refine + infinite scroll)
	function baseParams(nextCursor: string | null) {
		return {
			scope,
			projectId,
			channelId: scope === "project" ? activeChannel.value : (channelId ?? null),
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
		const res = await FilesService.list(baseParams(null));
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			const page = res.data.page;
			items.value = page.items;
			// The tree's channel index is the project's FULL channel set. When the workspace is filtered
			// to ONE channel the backend returns only that channel's index (it infers scope from the
			// channelId), so keep the existing full index rather than collapsing the tree to the selection.
			if (!(scope === "project" && activeChannel.value !== null)) {
				channels.value = page.channels;
			}
			cursor.value = page.nextCursor;
			hasMore.value = page.hasMore;
			total.value = page.total;
		}
	}

	async function loadMore(): Promise<void> {
		if (loadingMore.value || loading.value || !hasMore.value || !cursor.value) return;
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
	}
	// #endregion

	// #region Toolbar handlers
	function onSearch(v: string): void {
		query.value = v;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => void reload(), 300) as unknown as number;
	}
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
	function onFilter(kinds: string[]): void {
		filterKinds.value = kinds;
		void reload();
	}
	function onSelectChannel(id: string | null): void {
		activeChannel.value = id;
		void reload();
	}
	// #endregion

	// #region Preview modal
	function open(file: FileItem): void {
		openId.value = file.id;
	}
	function renameFile(id: string, name: string): void {
		items.value = items.value.map((f) => (f.id === id ? { ...f, name } : f));
	}
	function toggleStar(id: string): void {
		items.value = items.value.map((f) => (f.id === id ? { ...f, starred: !f.starred } : f));
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
			sortKey={sortKey}
			sortDir={sortDir}
			onSort={applySort}
			onOpen={open}
			onReachEnd={loadMore}
			loadingMore={loadingMore.value}
		/>
	);

	function toolbar(): JSX.Element {
		return (
			<div class="fx-toolbar">
				<div class="fx-toolbar__search">
					<InputText
						type="search"
						variant="bare"
						size="sm"
						block
						placeholder="Search files…"
						aria-label="Search files"
						value={query}
						onValueChange={onSearch}
						start={
							<span class="fx-toolbar__searchicon" aria-hidden="true">
								<SearchIcon size={16} />
							</span>
						}
					/>
				</div>
				<span class="fx-toolbar__spacer" />
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="All types"
					aria-label="Filter by type"
					options={FILE_KIND_OPTIONS}
					value={filterKinds}
					onValueChange={onFilter}
				/>
				<SortControl
					size="sm"
					options={FILE_SORT_OPTIONS}
					value={sortKey}
					direction={sortDir}
					onValueChange={() => void reload()}
					onDirectionChange={() => void reload()}
				/>
			</div>
		);
	}

	return (
		<div class="fx-explorer" data-scope={scope}>
			{scope === "project"
				? (
					<div class="fx-layout">
						<aside class="fx-aside-tree">
							<FileChannelTree
								channels={channels.value}
								active={activeChannel}
								onSelect={onSelectChannel}
								total={channels.value.reduce((s, c) => s + c.count, 0)}
							/>
						</aside>
						<div class="fx-main">
							{toolbar()}
							<div class="fx-workspace" ref={workspaceRef}>{workspaceView}</div>
						</div>
					</div>
				)
				: (
					<>
						{toolbar()}
						<div class="fx-workspace" ref={workspaceRef}>{workspaceView}</div>
					</>
				)}

			<AttachmentPreviewModal
				open={!!openFile}
				files={group}
				startIndex={startIndex}
				viewerId={viewerId}
				projectId={projectId}
				onClose={() => (openId.value = null)}
				onRename={renameFile}
				onToggleStar={toggleStar}
			/>
		</div>
	);
}
