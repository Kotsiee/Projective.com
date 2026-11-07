import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// #region Stylesheet carriers
/**
 * A stylesheet reaches a page ONLY through a client/island bundle: a sheet imported by a server
 * component ships nothing. Every shared component this island mounts — the file card, the table, the
 * folder card and the preview modal — therefore has its sheet imported HERE, at the hydration root,
 * rather than relying on the component's own import being collected from somewhere it is not.
 */
import "@web/features/projects/styles/file-card.css";
import "@web/features/projects/styles/submission-card.css";
import "@web/features/projects/styles/attachment-modal.css";
import "../styles/files-hub.css";
// #endregion

import type { ReadonlySignal } from "@preact/signals";
import { VirtualGrid } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { InlineNotice, Tooltip } from "@projective/ui/feedback";
import { OFFLINE_NOTICE_TEXT } from "@web/utils/offline.ts";
import { useOfflineStall } from "@web/utils/use-offline-stall.ts";
import { Icon, type IconName } from "@projective/ui/icons";
import { DndContext, type DragEndEvent, DragOverlay, useDnd } from "@projective/ui/dnd";
import { ActionMenu, type MenuItem } from "@projective/ui/navigation";

import { FileTable } from "@web/features/projects/components/FileTable.tsx";
import { SubmissionNodeList } from "@web/features/projects/components/SubmissionNodeList.tsx";
import { AttachmentPreviewModal } from "@web/features/projects/components/AttachmentPreviewModal.tsx";
import { filesZoom, gridColWidth, viewMode, displayZoom } from "@web/features/projects/core/view-state.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";

import {
	type AssetFolder,
	type AssetItem,
	type AssetListPage,
	type AssetListParams,
	type AssetTreeNode,
	type FileSortDir,
	type FileSortKey,
} from "../types/file-types.ts";
import { FilesService } from "../core/FilesService.ts";
import {
	facetsOfSearch,
	type FolderRouting,
	locationHref,
	parentPath,
	searchWithFacets,
	segmentsOfHref,
	shapeFolderAsNode,
} from "../core/asset-model.ts";
import {
	dragAttrs,
	dragOf,
	dropAttrs,
	folderOfDrop,
	isIdleDrop,
	payloadOf,
} from "../core/files-dnd.ts";
import {
	cellId,
	cellName,
	cellsOf,
	type ExplorerCell,
	managesFolder,
	rowsOf,
} from "../core/files-keyboard.ts";
import {
	download,
	moveRows,
	openInNewTab,
	renameFolder,
	shareHrefOf,
} from "../core/files-actions.ts";
import { shareRow } from "@features/share/core/share-menu.ts";
import {
	canGoBack,
	canGoForward,
	pinFilesEntry,
	pushFilesEntry,
	syncFilesEntry,
} from "../core/files-history.ts";
import {
	appendPage,
	applyError,
	anchorId,
	applyPage,
	askNewFolder,
	attachLinkOpen,
	beginLoad,
	busy,
	categoryFilter,
	channelId,
	clearFilesFilters,
	clearSelection,
	crumbs,
	currentPath,
	currentScope,
	DEFAULT_SORT,
	enqueueUploads,
	error,
	filesCanvasFocus,
	filesCommit,
	filesNavigate,
	folderId,
	folders,
	hasMore,
	inspectId,
	inspectSelection,
	isCut,
	items,
	loading,
	narrowed,
	nextCursor,
	pendingRemoval,
	previewId,
	query,
	readOnly,
	removalOpen,
	renaming,
	resetFilesState,
	seeded,
	selection,
	selectOnly,
	sortDir,
	sortKey,
	sourceFilter,
	subjectId,
	tree,
	viewerId,
	visibilityFilter,
} from "../core/files-state.ts";
import { uploadTasksOf } from "../core/upload-tasks.ts";
import { useFileDrop } from "../hooks/use-file-drop.ts";
import { useFileExplorerKeyboardShortcuts } from "../hooks/use-file-explorer-keyboard-shortcuts.ts";
import { AssetBreadcrumbs } from "../components/AssetBreadcrumbs.tsx";
import { AssetCard } from "../components/AssetCard.tsx";
import { AssetFolderCard } from "../components/AssetFolderCard.tsx";
import { FileDropOverlay } from "../components/FileDropOverlay.tsx";
import { FilesEmptyState } from "../components/FilesEmptyState.tsx";
import { DRAG_DISTANCE, FilesDragSurface, underPointer } from "../components/FilesDragSurface.tsx";
import { folderColorRow } from "../components/FolderColorGrid.tsx";
import { FolderMark } from "../components/FolderMark.tsx";
import { ItemMenu } from "../components/ItemMenu.tsx";
import { RenameField } from "../components/RenameField.tsx";
import { starFile } from "@features/files/core/star-file.ts";

/**
 * FilesHub — the BODY of the `/files` asset hub: the breadcrumb trail and the zoom-driven workspace.
 * One hydration root, and **the single fetch owner** — the lane, the header band and the footer rig
 * write intent into `files-state` and call `commitFiles()`; this island is what turns that into a
 * request. There is therefore exactly one request path, and no region can describe data it did not
 * load.
 *
 * ## Click selects, double click opens, empty canvas clears
 *
 * In both views a plain click on a file or a folder selects it, and a double click opens it (the file
 * in the preview modal, the folder in place); a touch tap on a folder still drills down. What the
 * selection describes streams into {@link FilesInspector}, the frame's right panel, only while the
 * person has that panel open (`core/details-panel.ts`): closed, a click highlights and nothing slides
 * in. A press that starts and ends on empty canvas, not on an item, a control, the crumb bar or the
 * table's header, clears the selection ({@link KEEPS_SELECTION}).
 *
 * ## What the body deliberately does NOT contain
 *
 * No tabs and no filter dropdowns (the region contract `/wallet` established and `/messages` was rebuilt
 * to match). The body views and selects; the LANE navigates and scopes, the HEADER carries identity and
 * the global controls, the FOOTER carries every standing action. Two doors in are the body's own
 * (Decision #311, amending #67 (B)): an empty writable folder's "Upload files", because the empty
 * state is where a first-time reader is looking, and the body as a DROP target for files from the
 * operating system — the highlight is drawn inside the hub, so it can never spill over the sidebar or
 * the lane. Both feed the same upload queue the footer does. A narrowed empty state offers "Clear
 * filters" instead: the way out of a state the body is currently rendering.
 *
 * ## The keyboard
 *
 * {@link useFileExplorerKeyboardShortcuts} is the canvas's desktop keyboard and its modified clicks, and
 * says how it scopes itself. It finds an item by `data-key`, which `.fh-cell` and a `DataTable` row both
 * carry, so the two views and the two kinds of row answer the same keys.
 *
 * ## Density is borrowed, never re-instantiated
 *
 * The zoom store is the File Explorer's (`projects/core/view-state.ts`, `LocalKeys.FILES_ZOOM`), so the
 * footer rig, this workspace and every other `/files` surface move together. One continuous zoom drives
 * list-below-centre and grid-above-centre, and `Ctrl`+wheel anywhere over the content viewport nudges
 * it (default-prevented so the browser never page-zooms instead).
 *
 * ## One grid holds folders AND files
 *
 * `.fx-card__meta` and `.subm-card__meta` are both exactly 62px, which is why a single `rowHeight` of
 * `cellWidth + 62 + gap` fits both cells and the virtualizer's maths never drifts from what is
 * painted. That constant is the reason the folder card is `SubmissionCard` shaped through
 * `shapeFolderAsNode` rather than a second card family.
 *
 * ## Window virtualization is correct HERE and nowhere else in this feature
 *
 * The hub body scrolls in the page, so `VirtualGrid useWindow` and `FileTable`'s default window
 * virtualization measure the box the rows are actually in. Inside a modal — the picker, the upload
 * drawer, the share dialog — the scroller is the dialog's own body and the same measurement would be of
 * a box the rows do not occupy, so those surfaces pass `virtualize={false}` and use a plain CSS grid.
 *
 * ## Mobile
 *
 * Below 767px the shell REMOVES the middle-nav lane, so the tree is gone. Navigation duty transfers to
 * the body rather than disappearing: folder cards drill down and the breadcrumb trail climbs back out,
 * which is a complete loop without the lane. (`/projects` has no such answer; this surface does not
 * inherit that.)
 */

// #region Props
export interface FilesHubProps {
	/** The SSR-resolved location — assets, folders, crumbs, `readOnly`, and the hub's allowance. */
	initial: AssetListPage;
	/** Why the first read failed, or `null` — the body opens in its error state rather than empty. */
	initialError?: string | null;
	/** The SSR-resolved navigation tree for the scope (the lane draws it; the body seeds it). */
	tree: AssetTreeNode[];
	/** The path segments the URL addressed; `[]` is the scope root. */
	path: string[];
	/** The scope base every deep link hangs off (default the hub root). */
	base?: string;
	/**
	 * Where a folder path lives in the address: under {@link base} (the default, for a wildcard route)
	 * or in its `?path=` query (a console drive, whose `[module]` route is one segment deep).
	 */
	routing?: FolderRouting;
	/** The empty library's sentence, when the host's library is not the person's own. */
	emptyNote?: string;
	/** Why a read-only location takes nothing, when the host knows (an archived entity's drive). */
	readOnlyNote?: string | null;
	/**
	 * Whether this viewer may upload into the library at all (default `true`). A host that mounts no
	 * `UploadDrawer` for the viewer must pass `false`, or a dropped file would queue with nothing to
	 * drain it.
	 */
	canUpload?: boolean;
}
// #endregion

// #region Constants
/** The grid gap, in px — shared by the layout and the virtualizer's row maths. */
const GRID_GAP = 16;

/** A folder's mark in a list row, in px. */
const LIST_MARK = 22;

/**
 * The card caption height, in px.
 *
 * A literal rather than a measurement because BOTH card families are built to it (`.fx-card__meta` and
 * `.subm-card__meta` are each 3.875rem = 62px). Measuring it per render would make the virtualizer's
 * row height depend on layout that has not happened yet on the first paint.
 */
const CARD_META = 62;

/** The address segment of a folder in view: its name in the library, its own id in a drive. */
function segmentOf(folder: AssetFolder): string {
	return folder.externalFolderId ?? folder.name;
}

/** A folder's drag and drop marks: a mounted folder is browsable, and takes neither. */
function folderMarks(folder: AssetFolder): Record<`data-${string}`, string> | null {
	return managesFolder(folder)
		? { ...dragAttrs("folder", folder.id), ...dropAttrs(folder.id) }
		: null;
}

/** An asset's drag mark: only what the viewer manages moves. */
function assetMarks(asset: AssetItem): Record<`data-${string}`, string> | null {
	return asset.canManage ? dragAttrs("asset", asset.id) : null;
}

/** What marks a cell held by a cut. */
function cellClass(id: string): string {
	return isCut(id) ? "fh-cell is-cut" : "fh-cell";
}

/** A `DataTable` row's token for the same. */
function rowStateOf(row: { id: string }): string | null {
	return isCut(row.id) ? "cut" : null;
}

/**
 * What a press on the canvas may land on without clearing the selection: an item, any control, the
 * crumb bar and the table's header. The toolbars, the footer, the details panel and every menu are
 * outside the hub's DOM already (other regions, or portalled), so they never reach the handler.
 */
const KEEPS_SELECTION = [
	".fh-cell",
	".ui-dt__row",
	".ui-dt__head",
	".fh-hub__crumbbar",
	"a",
	"button",
	"input",
	"textarea",
	"select",
	"label",
	"summary",
	"[contenteditable]",
	"[role='button']",
	"[role='checkbox']",
	"[role='menu']",
	"[role='menuitem']",
].join(", ");

/** Whether a press landed on empty canvas. */
function onEmptyCanvas(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(KEEPS_SELECTION) === null;
}

/** A press with a modifier extends or toggles elsewhere; on empty canvas it changes nothing. */
function plainPress(e: MouseEvent): boolean {
	return e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}
// #endregion

// #region Cells
interface AssetCellProps {
	asset: AssetItem;
	selected: boolean;
	onSelect: (asset: AssetItem) => void;
	onPreview: (asset: AssetItem) => void;
	onOpenRaw: (asset: AssetItem) => void;
	/** The item's kebab and right-click rows. */
	rows: (asset: AssetItem) => MenuItem[];
}

/**
 * AssetCell — an {@link AssetCard}, its kebab, and the marks {@link FilesDragSurface} reads: the whole
 * cell is the handle, so there is no grip to reach for.
 */
function AssetCell(props: AssetCellProps): JSX.Element {
	const { asset, selected, onSelect, onPreview, onOpenRaw, rows } = props;
	const cell = useRef<HTMLDivElement>(null);

	return (
		<div class={cellClass(asset.id)} ref={cell} data-key={asset.id} {...assetMarks(asset)}>
			<AssetCard
				asset={asset}
				selected={selected}
				onSelect={onSelect}
				onPreview={onPreview}
				onOpenRaw={onOpenRaw}
			/>
			<ItemMenu model={rows(asset)} label={asset.name} surface={cell} />
		</div>
	);
}

interface FolderCellProps {
	folder: AssetFolder;
	selected: boolean;
	onOpen: (folder: AssetFolder) => void;
	onSelect: (folder: AssetFolder) => void;
	rows: (folder: AssetFolder) => MenuItem[];
}

/**
 * FolderCell — an {@link AssetFolderCard} that drags and takes drops, its kebab beside it.
 *
 * A mounted folder is NOT a target: the hub shows a connected drive so a person can find and attach
 * what they already have, not so it can become a second write path into someone else's system of
 * record. It stays in the grid unmarked: still browsable, it simply refuses a drop.
 */
function FolderCell({ folder, selected, onOpen, onSelect, rows }: FolderCellProps): JSX.Element {
	const cell = useRef<HTMLDivElement>(null);

	return (
		<div class={cellClass(folder.id)} ref={cell} data-key={folder.id} {...folderMarks(folder)}>
			<AssetFolderCard folder={folder} selected={selected} onOpen={onOpen} onSelect={onSelect} />
			<ItemMenu model={rows(folder)} label={folder.name} surface={cell} />
		</div>
	);
}

/** One ghost control of the crumb bar. */
function CrumbNav(
	props: { icon: IconName; label: string; disabled: boolean; onClick: () => void },
): JSX.Element {
	return (
		<Tooltip content={props.label} placement="bottom">
			<Button
				iconOnly
				rounded
				size="sm"
				variant="text"
				severity="secondary"
				class="ui-hit"
				icon={<Icon name={props.icon} size="sm" />}
				aria-label={props.label}
				disabled={props.disabled}
				onClick={props.onClick}
			/>
		</Tooltip>
	);
}

/**
 * The ghost, saying what the drag carries. It reads the drag out here because `DragOverlay` portals its
 * children to the body, past the context they would read it from.
 */
function DragGhost({ selected }: { selected: number }): JSX.Element {
	const { store } = useDnd();
	const source = store.active.value ? dragOf(String(store.active.value.id)) : null;
	const many = selected > 1 && selection.value.includes(source?.id ?? "");
	const label = many
		? `${selected} items`
		: source?.kind === "folder"
		? "Move folder"
		: "Move file";
	return (
		<DragOverlay class="fh-ghost">
			<span class="fh-ghost__chip">{label}</span>
		</DragOverlay>
	);
}
// #endregion

// #region Workspace
interface WorkspaceProps {
	cells: ExplorerCell[];
	assets: AssetItem[];
	folderList: AssetFolder[];
	sortKey: ReadonlySignal<string>;
	sortDir: ReadonlySignal<FileSortDir>;
	onSort: (key: FileSortKey) => void;
	selection: readonly string[];
	onSelectionChange: (ids: string[]) => void;
	onSelect: (asset: AssetItem) => void;
	onPreview: (asset: AssetItem) => void;
	onOpenRaw: (asset: AssetItem) => void;
	onOpenFolder: (folder: AssetFolder) => void;
	onSelectFolder: (folder: AssetFolder) => void;
	onReachEnd: () => void;
	busy: boolean;
	assetRows: (asset: AssetItem) => MenuItem[];
	folderRows: (folder: AssetFolder) => MenuItem[];
}

/**
 * Workspace — the zoom-reactive body.
 *
 * It reads {@link viewMode}/{@link zoom} HERE rather than at the island root, so a `Ctrl`+wheel tick
 * re-renders only the cells — the breadcrumbs, the Inspect pane and the mounted preview modal are left
 * alone. (The same reason the File Explorer splits its `WorkspaceView` out.)
 */
function Workspace(p: WorkspaceProps): JSX.Element {
	if (viewMode.value === "grid") {
		return (
			<VirtualGrid
				items={p.cells}
				minColWidth={gridColWidth(displayZoom.value)}
				fit="exact"
				rowHeight={(w) => w + CARD_META + GRID_GAP}
				gap={GRID_GAP}
				useWindow
				overscan={3}
				onReachEnd={p.onReachEnd}
				loading={p.busy}
				getItemKey={(cell) => cell.kind === "folder" ? `f:${cell.folder.id}` : `a:${cell.asset.id}`}
				aria-label="Files and folders"
				itemTemplate={(cell) =>
					cell.kind === "folder"
						? (
							<FolderCell
								folder={cell.folder}
								selected={selection.value.includes(cell.folder.id)}
								onOpen={p.onOpenFolder}
								onSelect={p.onSelectFolder}
								rows={p.folderRows}
							/>
						)
						: (
							<AssetCell
								asset={cell.asset}
								selected={selection.value.includes(cell.asset.id)}
								onSelect={p.onSelect}
								onPreview={p.onPreview}
								onOpenRaw={p.onOpenRaw}
								rows={p.assetRows}
							/>
						)}
			/>
		);
	}

	const folderOf = (node: { segment: string }) => p.folderList.find((f) => f.name === node.segment);

	return (
		<div class="fh-list">
			{p.folderList.length > 0
				? (
					<SubmissionNodeList
						nodes={p.folderList.map((folder) => shapeFolderAsNode(folder))}
						header={false}
						aria-label="Folders"
						openOn="dblclick"
						rowKey={(node) => folderOf(node)?.id ?? node.segment}
						selection={p.selection}
						onSelectionChange={p.onSelectionChange}
						rowState={(node) => {
							const folder = folderOf(node);
							return folder ? rowStateOf(folder) : null;
						}}
						lead={(node) => <FolderMark color={folderOf(node)?.color} size={LIST_MARK} />}
						onOpen={(node) => {
							const folder = folderOf(node);
							if (folder) p.onOpenFolder(folder);
						}}
						rowActions={(node) => {
							const folder = folderOf(node);
							return folder ? p.folderRows(folder) : [];
						}}
						rowAttrs={(node) => {
							const folder = folderOf(node);
							return folder ? folderMarks(folder) : null;
						}}
					/>
				)
				: null}
			<FileTable
				items={p.assets}
				sortKey={p.sortKey}
				sortDir={p.sortDir}
				onSort={p.onSort}
				selection={p.selection}
				onSelectionChange={p.onSelectionChange}
				selectionAnchor={anchorId}
				onOpen={p.onPreview}
				openOn="dblclick"
				onReachEnd={p.onReachEnd}
				loading={p.busy}
				rowActions={p.assetRows}
				rowAttrs={assetMarks}
				rowState={rowStateOf}
			/>
		</div>
	);
}
// #endregion

export default function FilesHub(props: FilesHubProps): JSX.Element {
	const { initial, tree: initialTree, path, base = "/files", routing = "path", canUpload = true } =
		props;

	// #region Local (view) state — never in `files-state`, because no other region reads it
	/** A tail page is loading — distinct from `loading`, which replaces the contents. */
	const loadingMore = useSignal(false);

	/**
	 * A failure that happened while APPENDING a page.
	 *
	 * Deliberately not `applyError`: that would flip the body to its error state and take the rows the
	 * person already has off the screen, which turns "the next page did not arrive" into "your files
	 * disappeared". A tail failure is reported under the grid, beside the rows it failed to extend.
	 */
	const tailError = useSignal<string | null>(null);

	const reqId = useRef(0);
	const workspaceRef = useRef<HTMLDivElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const hubRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Query
	/**
	 * The list params for a read.
	 *
	 * ONE builder for both the first page and every subsequent one, which is the point: the sibling
	 * ledger on `/wallet` built its `loadMore` params separately, omitted the fund-state filter, and
	 * appended an unfiltered page 2 onto filtered rows. A single builder makes that class of bug
	 * unreachable rather than merely absent.
	 */
	function listParams(cursor: string | null): AssetListParams {
		return {
			scope: currentScope.value,
			subjectId: subjectId.value,
			channelId: channelId.value,
			path: currentPath.value.length > 0 ? currentPath.value : undefined,
			sort: sortKey.value,
			dir: sortDir.value,
			categories: categoryFilter.value.length > 0 ? categoryFilter.value : undefined,
			sources: sourceFilter.value.length > 0 ? sourceFilter.value : undefined,
			visibility: visibilityFilter.value.length > 0 ? visibilityFilter.value : undefined,
			query: query.value.trim() || undefined,
			cursor,
		};
	}

	/**
	 * Re-read the current location.
	 *
	 * Every path ends in `applyPage` OR `applyError` — never in silence. A refetch with no `else` leaves
	 * the previous location's contents on screen indefinitely while the breadcrumbs claim to be
	 * somewhere else, which is how a person deletes the wrong file.
	 */
	async function reload(): Promise<void> {
		writeFacetsToAddress();
		const my = ++reqId.current;
		tailError.value = null;
		beginLoad();
		const res = await FilesService.list(listParams(null));
		if (my !== reqId.current) return;
		if (res.ok && res.data) applyPage(res.data);
		else applyError(res.message ?? "Those files could not be loaded.");
	}

	/** Append the next page. Guarded so a fast scroll cannot fire two requests for the same cursor. */
	async function loadMore(): Promise<void> {
		if (
			loadingMore.value || stall.blocked.value || loading.value || !hasMore.value ||
			!nextCursor.value
		) return;
		const my = reqId.current;
		loadingMore.value = true;
		const res = await FilesService.list(listParams(nextCursor.value));
		loadingMore.value = false;
		// A location change during the request supersedes this page entirely — appending it would mix
		// two folders' contents into one grid.
		if (my !== reqId.current) return;
		if (res.ok && res.data) {
			tailError.value = null;
			appendPage(res.data);
			stall.settle(true);
		} else if (stall.settle(false)) {
			// Offline: the shared stall notice says so and owns the Retry; the danger strip is for a
			// server that answered badly, not a network that did not answer at all.
			tailError.value = null;
		} else {
			tailError.value = res.message ?? "The next page could not be loaded.";
		}
	}
	const stall = useOfflineStall(loadMore);
	// #endregion

	// #region Navigation
	/**
	 * Mirror the facet filters into the address (`?categories=` · `?sources=` · `?visibility=`, the list
	 * API's own names) so a filtered view is a shareable link. Replaced, not pushed: a filter is not a
	 * place, and Back should leave the folder rather than step through every toggle.
	 */
	function writeFacetsToAddress(): void {
		if (typeof history === "undefined") return;
		const search = searchWithFacets(globalThis.location.search, {
			categories: categoryFilter.value,
			sources: sourceFilter.value,
			visibility: visibilityFilter.value,
		});
		if (search === globalThis.location.search) return;
		history.replaceState(
			history.state,
			"",
			globalThis.location.pathname + search + globalThis.location.hash,
		);
	}

	/** Read the facet filters back out of the address (first paint, Back / Forward). */
	function readFacetsFromAddress(): void {
		const facets = facetsOfSearch(globalThis.location.search);
		categoryFilter.value = facets.categories;
		sourceFilter.value = facets.sources;
		visibilityFilter.value = facets.visibility;
	}

	/**
	 * Move to a path, in place.
	 *
	 * The URL is pushed so a folder stays a real, shareable address (the submissions precedent) and the
	 * browser's Back button walks the folder history. Selection and the Inspect pane are cleared,
	 * because both describe assets that are about to stop being listed.
	 */
	function navigate(next: string[]): void {
		const search = globalThis.location?.search ?? "";
		const href = locationHref(base, next, routing, search);
		const here = (globalThis.location?.pathname ?? "") + search;
		if (typeof history !== "undefined" && here !== href) pushFilesEntry(href);
		currentPath.value = next;
		clearSelection();
		inspectId.value = null;
		void reload();
	}
	// #endregion

	// #region Selection
	/**
	 * A plain click on a file or a folder. A modified one never gets here: the keyboard hook answers it,
	 * in either view. The details panel shows the pick only while it is open; selecting never opens it.
	 */
	function onSelect(asset: AssetItem): void {
		selectOnly(asset.id);
		inspectSelection();
	}

	function onSelectFolder(folder: AssetFolder): void {
		selectOnly(folder.id);
		inspectSelection();
	}

	/** Where the last plain press on empty canvas began; `null` when it began anywhere else. */
	const emptyPress = useRef<{ x: number; y: number } | null>(null);

	function onCanvasPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		emptyPress.current = plainPress(e) && onEmptyCanvas(e.target)
			? { x: e.clientX, y: e.clientY }
			: null;
	}

	/**
	 * Click-away: a press that began AND ended on empty canvas, without travelling as far as a drag,
	 * clears the selection. Both ends are checked because a drag from a card that is let go over empty
	 * space fires its click on the common ancestor, which would otherwise read as a click away.
	 */
	function onCanvasClick(e: JSX.TargetedMouseEvent<HTMLDivElement>): void {
		const press = emptyPress.current;
		emptyPress.current = null;
		if (!press || !plainPress(e) || !onEmptyCanvas(e.target)) return;
		if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_DISTANCE) return;
		if (selection.peek().length === 0) return;
		clearSelection();
		inspectSelection();
	}

	/** List-view selection: a row's check; Inspect follows a single selected asset. */
	function onTableSelection(ids: string[]): void {
		selection.value = ids;
		inspectSelection();
	}

	// #endregion

	// #region Menus
	function askRemoval(name: string, assetIds: string[], folderIds: string[]): void {
		pendingRemoval.value = { assetIds, folderIds, name };
		removalOpen.value = true;
	}

	/** The keyboard's delete: the same confirmation, over what of these the viewer may remove. */
	function removeCells(chosen: ExplorerCell[]): void {
		const { assetIds, folderIds } = rowsOf(chosen);
		const count = assetIds.length + folderIds.length;
		const only = chosen.find((c) => assetIds.includes(cellId(c)) || folderIds.includes(cellId(c)));
		askRemoval(count === 1 && only ? cellName(only) : `${count} items`, assetIds, folderIds);
	}

	/**
	 * An item's rows, for its kebab and its right-click. Kept to one function per hub, so a table row
	 * does not re-render for a menu that cannot have changed: all they read, they read when pressed.
	 */
	const assetRows = useRef((asset: AssetItem): MenuItem[] => [
		{
			key: "open",
			label: "Open in Current Page",
			icon: "eye",
			command: () => (previewId.value = asset.id),
		},
		{
			key: "tab",
			label: "Open in New Tab",
			icon: "external-link",
			command: () => openInNewTab(asset),
		},
		{ key: "download", label: "Download", icon: "download", command: () => void download(asset) },
		shareRow({ title: asset.name, href: shareHrefOf(asset) }, viewerId.peek() !== ""),
		...(asset.canManage
			? [
				{
					key: "rename",
					label: "Rename",
					icon: "edit",
					shortcut: "F2",
					command: () => (renaming.value = { kind: "asset", asset }),
				},
				{
					key: "delete",
					label: "Archive / Delete",
					icon: "trash",
					danger: true,
					command: () => askRemoval(asset.name, [asset.id], []),
				},
			]
			: []),
	]).current;

	const folderRows = useRef((folder: AssetFolder): MenuItem[] => [
		{
			key: "open",
			label: "Open in Current Page",
			icon: "folder",
			command: () => openFolder(folder),
		},
		{
			key: "tab",
			label: "Open in New Tab",
			icon: "external-link",
			command: () =>
				void globalThis.open(
					locationHref(base, [...currentPath.value, segmentOf(folder)], routing),
					"_blank",
					"noopener,noreferrer",
				),
		},
		...(managesFolder(folder)
			? [
				{ separator: true },
				folderColorRow({ folderId: folder.id, name: folder.name, color: folder.color }),
				{ separator: true },
				{
					key: "rename",
					label: "Rename",
					icon: "edit",
					shortcut: "F2",
					command: () => (renaming.value = { kind: "folder", folder }),
				},
				{
					key: "delete",
					label: "Archive / Delete",
					icon: "trash",
					danger: true,
					command: () => askRemoval(folder.name, [], [folder.id]),
				},
			]
			: []),
	]).current;

	function openFolder(folder: AssetFolder): void {
		navigate([...currentPath.value, segmentOf(folder)]);
	}

	function goUp(): void {
		navigate(parentPath(currentPath.value));
	}
	// #endregion

	// #region Mutations
	/**
	 * Rename, optimistically, then persist.
	 *
	 * The optimistic write is what keeps the modal's inline edit feeling like editing rather than
	 * submitting; a failure re-reads, so the server's name is what survives a disagreement.
	 */
	async function rename(assetId: string, name: string): Promise<void> {
		items.value = items.value.map((a) => (a.id === assetId ? { ...a, name } : a));
		const res = await FilesService.rename({ assetId, name });
		if (!res.ok) {
			applyError(res.message ?? "That file could not be renamed.");
			await reload();
		}
	}

	/** Star or unstar — the owner's mark, persisted through the saved system (Decision #180). */
	function toggleStar(assetId: string) {
		return starFile(items, assetId);
	}
	// #endregion

	// #region Sort
	/**
	 * Header clicks cycle a column asc → desc → the default order (newest first), which is what "no
	 * sort" means on the other file surfaces. The default is itself a sort, so on Date the cycle
	 * steps from the default to ascending instead of standing still.
	 */
	function applySort(key: FileSortKey): void {
		const atDefault = sortKey.value === DEFAULT_SORT.key && sortDir.value === DEFAULT_SORT.dir;
		if (sortKey.value !== key) {
			sortKey.value = key;
			sortDir.value = "asc";
		} else if (sortDir.value === "asc") {
			sortDir.value = "desc";
		} else if (atDefault) {
			sortDir.value = "asc";
		} else {
			sortKey.value = DEFAULT_SORT.key;
			sortDir.value = DEFAULT_SORT.dir;
		}
		void reload();
	}
	// #endregion

	// #region Uploads into the body
	function takesFiles(): boolean {
		return canUpload && seeded.value && !readOnly.value;
	}

	function uploadFiles(files: readonly File[]): void {
		if (files.length === 0 || !takesFiles()) return;
		enqueueUploads(uploadTasksOf(files, folderId.value));
	}

	const drop = useFileDrop(takesFiles, uploadFiles);
	// #endregion

	// #region Drag and drop
	function onDragEnd(e: DragEndEvent): void {
		if (e.canceled || e.over === null) return;
		const target = folderOfDrop(String(e.over));
		const manageable = rowsOf(cellsOf(folders.value, items.value));
		const payload = payloadOf(dragOf(String(e.active.id)), selection.value, manageable);
		if (!isIdleDrop(payload, target, folderId.value)) void moveRows(payload, target);
	}
	// #endregion

	// #region Keyboard
	const keyboard = useFileExplorerKeyboardShortcuts({
		containerRef: hubRef,
		takesPaste: takesFiles,
		onOpenFolder: openFolder,
		onUp: goUp,
		onRemove: removeCells,
	});
	// #endregion

	// #region Mount
	useCtrlWheelZoom(workspaceRef, filesZoom);

	useEffect(() => {
		// Seed from SSR, in the browser, where these module-level signals belong to one tab. (SSR must
		// never write them: on the server the module is per-PROCESS, so a write would leak one request's
		// library into the next person's first paint.)
		currentPath.value = path;
		channelId.value = null;
		// The server already read the first page with these facets; this only lets the controls show them.
		readFacetsFromAddress();
		tree.value = initialTree;
		applyPage({ ...initial, tree: initialTree });
		if (props.initialError) applyError(props.initialError);

		// Every other region asks for a read through here, so there is one fetch path, and moves
		// through here, so there is one history.
		filesCommit.value = () => void reload();
		filesCanvasFocus.value = keyboard.focusCanvas;
		filesNavigate.value = {
			toPath: navigate,
			toHref: (href) => navigate(segmentsOfHref(href, base, routing)),
		};
		pinFilesEntry();

		const onPop = () => {
			syncFilesEntry();
			const next = segmentsOfHref(
				globalThis.location.pathname + globalThis.location.search,
				base,
				routing,
			);
			currentPath.value = next;
			readFacetsFromAddress();
			clearSelection();
			inspectId.value = null;
			void reload();
		};
		globalThis.addEventListener("popstate", onPop);

		return () => {
			globalThis.removeEventListener("popstate", onPop);
			filesCommit.value = null;
			filesCanvasFocus.value = null;
			filesNavigate.value = null;
			// Module-level signals outlive this island, so a later navigation into another scope would
			// otherwise paint the previous library for a frame.
			resetFilesState();
		};
	}, []);
	// #endregion

	// #region Derived
	const previewAsset = previewId.value
		? items.value.find((a) => a.id === previewId.value) ?? null
		: null;

	/**
	 * The set the preview modal's carousel walks.
	 *
	 * Siblings of the same POST when the asset was posted as a message attachment (that is the group the
	 * modal's companion tray was built for); otherwise the whole visible folder, which is what "next"
	 * means for a library. Grouping every provenance-less asset together by their shared `null`
	 * `messageId` would put unrelated files in one post.
	 */
	const previewGroup = previewAsset
		? previewAsset.messageId
			? items.value.filter((a) => a.messageId === previewAsset.messageId)
			: items.value
		: [];
	const previewIndex = previewAsset
		? Math.max(0, previewGroup.findIndex((a) => a.id === previewAsset.id))
		: 0;

	const cells = cellsOf(folders.value, items.value);

	const isEmpty = seeded.value && cells.length === 0;
	const dragRows = rowsOf(cells.filter((c) => selection.value.includes(cellId(c))));
	const dragCount = dragRows.assetIds.length + dragRows.folderIds.length;

	/** The canvas's own menu. What writes is withheld by absence, as the footer withholds it. */
	const canvasRows: MenuItem[] = [
		...(takesFiles()
			? [
				{ key: "folder", label: "New Folder", icon: "folder", command: () => askNewFolder() },
				{
					key: "upload",
					label: "Upload File",
					icon: "upload",
					command: () => fileInput.current?.click(),
				},
				{
					key: "link",
					label: "Attach Link",
					icon: "link",
					command: () => (attachLinkOpen.value = true),
				},
				{ separator: true },
			]
			: []),
		{
			key: "back",
			label: "Back",
			icon: "arrow-left",
			disabled: !canGoBack.value,
			command: () => history.back(),
		},
		{
			key: "forward",
			label: "Forward",
			icon: "arrow-right",
			disabled: !canGoForward.value,
			command: () => history.forward(),
		},
		{
			key: "up",
			label: "Up Directory",
			icon: "arrow-up",
			disabled: currentPath.value.length === 0,
			command: goUp,
		},
	];
	// #endregion

	// #region Body
	function body(): JSX.Element {
		// An error only REPLACES the workspace when there is nothing to replace. With rows already on
		// screen it is reported above them (see `errorStrip`), because taking away data a person is
		// looking at is a worse failure than the one being reported.
		if (error.value && !seeded.value) {
			return (
				<div class="fh-state fh-state--error" role="alert">
					<p class="fh-state__title">These files could not be loaded</p>
					<p class="fh-state__note">{error.value}</p>
					<Button variant="outlined" size="sm" label="Try again" onClick={() => void reload()} />
				</div>
			);
		}

		if (!seeded.value && loading.value) {
			return (
				<div class="fh-state" role="status">
					<p class="fh-state__note">Loading your files…</p>
				</div>
			);
		}

		if (isEmpty) {
			return (
				<FilesEmptyState
					narrowed={narrowed.value}
					readOnly={readOnly.value}
					canUpload={canUpload}
					note={props.emptyNote}
					onUpload={() => fileInput.current?.click()}
					onClearFilters={clearFilesFilters}
				/>
			);
		}

		return (
			<Workspace
				cells={cells}
				assets={items.value}
				folderList={folders.value}
				sortKey={sortKey}
				sortDir={sortDir}
				onSort={applySort}
				selection={selection.value}
				onSelectionChange={onTableSelection}
				onSelect={onSelect}
				onPreview={(asset) => (previewId.value = asset.id)}
				onOpenRaw={openInNewTab}
				onOpenFolder={openFolder}
				onSelectFolder={onSelectFolder}
				onReachEnd={loadMore}
				busy={loadingMore.value}
				assetRows={assetRows}
				folderRows={folderRows}
			/>
		);
	}
	// #endregion

	/** A failure reported BESIDE the data rather than instead of it (see `body`). */
	const errorStrip = error.value && seeded.value
		? (
			<p class="fh-hub__error" role="alert">
				<Icon name="warning" size="2xs" aria-hidden="true" />
				<span>{error.value}</span>
				<Button variant="text" size="sm" label="Retry" onClick={() => void reload()} />
			</p>
		)
		: null;

	const workspace = (
		<div class="fh-hub__workspace" ref={workspaceRef}>
			{readOnly.value
				? (
					<p class="fh-hub__readonly">
						<Icon name="lock" size="2xs" aria-hidden="true" />
						<span>
							{props.readOnlyNote ??
								"You can browse and attach from here. Changes are made where these files live."}
						</span>
					</p>
				)
				: null}
			{errorStrip}
			{body()}
			{tailError.value
				? (
					<p class="fh-hub__error fh-hub__error--tail" role="alert">
						<Icon name="warning" size="2xs" aria-hidden="true" />
						<span>{tailError.value}</span>
						<Button variant="text" size="sm" label="Retry" onClick={() => void loadMore()} />
					</p>
				)
				: null}
			{stall.stalled.value
				? (
					<InlineNotice
						text={OFFLINE_NOTICE_TEXT}
						actionLabel="Retry"
						onAction={stall.retry}
						busy={stall.retrying.value}
					/>
				)
				: null}
		</div>
	);

	const here = currentPath.value.length > 0
		? crumbs.value.at(-1)?.label ?? currentPath.value.at(-1)
		: null;

	/** The name an open rename covers: a grid card's, or a list row's first cell after its check. */
	function renameAnchor(cell: ExplorerCell): Element | null {
		const item = hubRef.current?.querySelector(
			`.fh-cell[data-key="${CSS.escape(cellId(cell))}"], .ui-dt__row[data-key="${CSS.escape(cellId(cell))}"]`,
		);
		return item?.querySelector(".fx-card__name, .subm-card__name, .ui-dt__lead + .ui-dt__cell") ?? null;
	}

	const renamingCell = renaming.value;
	const renamingAnchor = renamingCell ? renameAnchor(renamingCell) : null;

	return (
		<div
			ref={hubRef}
			class="fh-hub"
			tabIndex={-1}
			data-scope={currentScope.value}
			data-busy={busy.value || undefined}
			data-drop={drop.active.value || undefined}
			{...drop.handlers}
			onPointerDown={onCanvasPointerDown}
			onClick={onCanvasClick}
		>
			{drop.active.value && <FileDropOverlay destination={here ?? "this library"} />}
			<span class="ui-visually-hidden" role="status">{keyboard.note.value}</span>
			{canUpload && (
				<input
					ref={fileInput}
					class="ui-visually-hidden"
					type="file"
					multiple
					tabIndex={-1}
					aria-hidden="true"
					onChange={(e) => {
						const el = e.currentTarget;
						uploadFiles(Array.from(el.files ?? []));
						el.value = "";
					}}
				/>
			)}
			<div class="fh-hub__crumbbar">
				<AssetBreadcrumbs
					crumbs={crumbs.value}
					base={base}
					routing={routing}
					onNavigate={navigate}
					droppable={!readOnly.value}
					aria-label="Folder path"
				/>
				<span class="fh-hub__crumbnav" role="group" aria-label="Folder history">
					<CrumbNav
						icon="arrow-left"
						label="Back"
						disabled={!canGoBack.value}
						onClick={() => history.back()}
					/>
					<CrumbNav
						icon="arrow-right"
						label="Forward"
						disabled={!canGoForward.value}
						onClick={() => history.forward()}
					/>
					<CrumbNav
						icon="arrow-up"
						label="Up one level"
						disabled={currentPath.value.length === 0}
						onClick={goUp}
					/>
				</span>
			</div>

			<DndContext
				activationDistance={DRAG_DISTANCE}
				collision={underPointer}
				onDragEnd={onDragEnd}
			>
				<FilesDragSurface>{workspace}</FilesDragSurface>
				<DragGhost selected={dragCount} />
			</DndContext>

			<ActionMenu
				model={canvasRows}
				aria-label="File actions"
				surface={hubRef}
				surfaceExclude="[data-fh-drag], a, button, input"
			/>

			{renamingCell && renamingAnchor && hubRef.current && (
				<RenameField
					key={cellId(renamingCell)}
					cell={renamingCell}
					anchor={renamingAnchor}
					hub={hubRef.current}
					onRename={(name) =>
						void (renamingCell.kind === "folder"
							? renameFolder(renamingCell.folder.id, name)
							: rename(renamingCell.asset.id, name))}
					onClose={(byKey) => {
						renaming.value = null;
						if (byKey) keyboard.focusCanvas();
					}}
				/>
			)}

			<AttachmentPreviewModal
				open={previewAsset !== null}
				files={previewGroup}
				startIndex={previewIndex}
				viewerId={viewerId.value}
				projectId={subjectId.value ?? ""}
				onClose={() => {
					previewId.value = null;
					keyboard.focusCanvas();
				}}
				onRename={(assetId, name) => void rename(assetId, name)}
				onToggleStar={toggleStar}
				context={{ kind: "files" }}
			/>
		</div>
	);
}
