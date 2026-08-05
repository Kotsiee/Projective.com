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
import "@web/features/projects/styles/file-table.css";
import "@web/features/projects/styles/submission-card.css";
import "@web/features/projects/styles/attachment-modal.css";
import "../styles/files-hub.css";
// #endregion

import type { Signal } from "@preact/signals";
import { VirtualGrid } from "@projective/ui/display";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	useDraggable,
	useDroppable,
} from "@projective/ui/dnd";

import { FileTable } from "@web/features/projects/components/FileTable.tsx";
import { SubmissionNodeList } from "@web/features/projects/components/SubmissionNodeList.tsx";
import { AttachmentPreviewModal } from "@web/features/projects/components/AttachmentPreviewModal.tsx";
import { filesZoom, gridColWidth, viewMode, zoom } from "@web/features/projects/core/view-state.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";

import {
	type AssetFolder,
	type AssetItem,
	type AssetListPage,
	type AssetListParams,
	type AssetTreeNode,
	type AssetVisibility,
	type FileSortDir,
	type FileSortKey,
	type FilesSim,
} from "../types/file-types.ts";
import { FilesService } from "../core/FilesService.ts";
import { assetHref, shapeFolderAsNode } from "../core/asset-model.ts";
import { simFromSeam, subscribeFilesSim } from "../core/files-seam.ts";
import {
	appendPage,
	applyError,
	applyPage,
	beginLoad,
	channelId,
	clearFilesFilters,
	clearSelection,
	crumbs,
	currentPath,
	currentScope,
	error,
	filesCommit,
	folders,
	hasMore,
	inspectId,
	items,
	kindFilter,
	loading,
	narrowed,
	nextCursor,
	query,
	rangeSelect,
	readOnly,
	resetFilesState,
	seeded,
	selection,
	selectOnly,
	sortDir,
	sortKey,
	sourceFilter,
	subjectId,
	toggleSelect,
	tree,
	viewerId,
} from "../core/files-state.ts";
import { AssetBreadcrumbs } from "../components/AssetBreadcrumbs.tsx";
import { type AssetActivation, AssetCard } from "../components/AssetCard.tsx";
import { AssetFolderCard } from "../components/AssetFolderCard.tsx";
import { InspectPanel } from "../components/InspectPanel.tsx";

/**
 * FilesHub — the BODY of the `/files` asset hub: the breadcrumb trail, the zoom-driven workspace, and
 * the Inspect pane. One hydration root, and **the single fetch owner** — the lane, the header band and
 * the footer rig write intent into `files-state` and call `commitFiles()`; this island is what turns
 * that into a request. There is therefore exactly one request path, and no region can describe data it
 * did not load.
 *
 * ## What the body deliberately does NOT contain
 *
 * No tabs, no filter dropdowns, no primary CTA (the region contract `/wallet` established and
 * `/messages` was rebuilt to match). The body views and selects; the LANE navigates and scopes, the
 * HEADER carries identity and the global controls, the FOOTER carries every action. The one recovery
 * affordance that does live here is the empty state's "Clear filters" — it is not a CTA, it is the way
 * out of a state the body is currently rendering, and hiding it in a band the reader is not looking at
 * would be a puzzle rather than a layout.
 *
 * ## Density is borrowed, never re-instantiated
 *
 * The zoom store is the File Explorer's (`projects/core/view-state.ts`, `LocalKeys.FILES_ZOOM`), so the
 * footer rig, this workspace and every other `/files` surface move together. One continuous zoom drives
 * grid-below-centre and list-above-centre — hence no grid/list toggle button — and `Ctrl`+wheel over
 * the workspace nudges it (default-prevented so the browser never page-zooms instead).
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
	/** The SSR-resolved navigation tree for the scope (the lane draws it; the body seeds it). */
	tree: AssetTreeNode[];
	/** The path segments the URL addressed; `[]` is the scope root. */
	path: string[];
	/** The scope base every deep link hangs off (default the hub root). */
	base?: string;
}
// #endregion

// #region Constants
/** The grid gap, in px — shared by the layout and the virtualizer's row maths. */
const GRID_GAP = 16;

/**
 * The card caption height, in px.
 *
 * A literal rather than a measurement because BOTH card families are built to it (`.fx-card__meta` and
 * `.subm-card__meta` are each 3.875rem = 62px). Measuring it per render would make the virtualizer's
 * row height depend on layout that has not happened yet on the first paint.
 */
const CARD_META = 62;

/** One workspace cell: a child folder or an asset. Folders lead, so containers are never buried. */
type Cell =
	| { kind: "folder"; folder: AssetFolder }
	| { kind: "asset"; asset: AssetItem };

/** The droppable id for a folder — the id space the drag end handler decodes a destination from. */
function folderDropId(folderId: string): string {
	return `fh-folder:${folderId}`;
}

/** The folder id a droppable id addresses, or `null` when it is not a folder target. */
function folderIdOfDrop(id: string | number | null): string | null {
	if (typeof id !== "string" || !id.startsWith("fh-folder:")) return null;
	return id.slice("fh-folder:".length);
}
// #endregion

// #region Cells
interface AssetCellProps {
	asset: AssetItem;
	selected: boolean;
	onSelect: (asset: AssetItem, activation: AssetActivation) => void;
	onPreview: (asset: AssetItem) => void;
	onOpenRaw: (asset: AssetItem) => void;
	/** How many assets a drag from this cell would carry — the grip's announced payload. */
	dragCount: number;
}

/**
 * AssetCell — an {@link AssetCard} plus its drag GRIP.
 *
 * The grip exists rather than making the whole card draggable, and the reason is accessibility, not
 * taste: `useDraggable`'s attributes put `role="button"` and a `tabIndex` on their host and its
 * `onKeyDown` claims Enter/Space. Spreading that over a card that already contains a real `<button>`
 * would nest two interactive roles and steal the card's own keyboard activation. Putting them on a
 * dedicated handle — the "partial handle" path the package documents — keeps Enter/Space on the card as
 * SELECT and gives keyboard drag its own affordance (Space to pick up, Arrows to move, Enter to drop).
 *
 * The grip is revealed on hover/focus-within so it costs the resting card nothing, but it is never
 * `display: none` at rest, because a control that only exists after a hover is unreachable by keyboard.
 */
function AssetCell(props: AssetCellProps): JSX.Element {
	const { asset, selected, onSelect, onPreview, onOpenRaw, dragCount } = props;
	const drag = useDraggable({
		id: asset.id,
		data: { type: "asset" },
		disabled: !asset.canManage,
		roleDescription: "file",
	});

	const moveLabel = dragCount > 1 ? `Move ${dragCount} selected files` : `Move ${asset.name}`;

	return (
		<div class="fh-cell" ref={drag.setNodeRef} data-dragging={drag.isDragging.value || undefined}>
			<AssetCard
				asset={asset}
				selected={selected}
				onSelect={onSelect}
				onPreview={onPreview}
				onOpenRaw={onOpenRaw}
			/>
			{asset.canManage
				? (
					<Tooltip content={moveLabel}>
						<span
							class="fh-cell__grip"
							aria-label={moveLabel}
							{...drag.attributes}
							{...drag.listeners}
						>
							<Icon name="grip" size="xs" />
						</span>
					</Tooltip>
				)
				: null}
		</div>
	);
}

interface FolderCellProps {
	folder: AssetFolder;
	onOpen: (folder: AssetFolder) => void;
}

/**
 * FolderCell — an {@link AssetFolderCard} registered as a drop target.
 *
 * A mounted folder is NOT a target: the hub shows a connected drive so a person can find and attach
 * what they already have, not so it can become a second write path into someone else's system of
 * record. Disabling the droppable rather than filtering it out keeps the card in the grid — the folder
 * is still browsable, it simply refuses a drop.
 */
function FolderCell({ folder, onOpen }: FolderCellProps): JSX.Element {
	const writable = folder.source === "supabase" && folder.canManage;
	const drop = useDroppable({
		id: folderDropId(folder.id),
		data: { accepts: ["asset"] },
		disabled: !writable,
	});

	return (
		<div class="fh-cell" ref={drop.setNodeRef}>
			<AssetFolderCard folder={folder} onOpen={onOpen} dropOver={drop.isOver.value} />
		</div>
	);
}
// #endregion

// #region Workspace
interface WorkspaceProps {
	cells: Cell[];
	assets: AssetItem[];
	folderList: AssetFolder[];
	tableSortKey: Signal<string>;
	tableSortDir: Signal<FileSortDir>;
	onSort: (key: FileSortKey) => void;
	onSelect: (asset: AssetItem, activation: AssetActivation) => void;
	onPreview: (asset: AssetItem) => void;
	onOpenRaw: (asset: AssetItem) => void;
	onOpenFolder: (folder: AssetFolder) => void;
	onReachEnd: () => void;
	busy: boolean;
	dragCount: number;
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
				minColWidth={gridColWidth(zoom.value)}
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
						? <FolderCell folder={cell.folder} onOpen={p.onOpenFolder} />
						: (
							<AssetCell
								asset={cell.asset}
								selected={selection.value.includes(cell.asset.id)}
								onSelect={p.onSelect}
								onPreview={p.onPreview}
								onOpenRaw={p.onOpenRaw}
								dragCount={p.dragCount}
							/>
						)}
			/>
		);
	}

	return (
		<div class="fh-list">
			{p.folderList.length > 0
				? (
					<SubmissionNodeList
						nodes={p.folderList.map((folder) => shapeFolderAsNode(folder))}
						onOpen={(node) => {
							const folder = p.folderList.find((f) => f.name === node.segment);
							if (folder) p.onOpenFolder(folder);
						}}
					/>
				)
				: null}
			<FileTable
				items={p.assets}
				sortKey={p.tableSortKey}
				sortDir={p.tableSortDir}
				onSort={p.onSort}
				onOpen={p.onPreview}
				onReachEnd={p.onReachEnd}
				loading={p.busy}
			/>
		</div>
	);
}
// #endregion

export default function FilesHub(props: FilesHubProps): JSX.Element {
	const { initial, tree: initialTree, path, base = "/files" } = props;

	// #region Local (view) state — never in `files-state`, because no other region reads it
	/** The asset the preview modal is open on; `null` closes it. */
	const previewId = useSignal<string | null>(null);
	/** A mutation (move / visibility / delete / rename) is in flight. */
	const busy = useSignal(false);
	/** A tail page is loading — distinct from `loading`, which replaces the contents. */
	const loadingMore = useSignal(false);

	/**
	 * The table's sort mirrors.
	 *
	 * `FileTable` takes `Signal<string>`, and `files-state` holds the canonical `Signal<FileSortKey>`;
	 * `Signal<T>` is invariant, so the state signal cannot be passed directly. These mirrors are kept in
	 * step with the canonical pair below, never written independently.
	 *
	 * **Deliberate divergence from the projects explorer:** that surface cycles a column asc → desc →
	 * NONE by clearing the key. The shared `files-state` contract types `sortKey` as a non-nullable
	 * `FileSortKey`, so "no column" is not expressible there — and inventing a local third state would
	 * mean the header band and the body disagreed about what is sorted. The hub cycles asc ⇄ desc.
	 */
	const tableSortKey = useSignal<string>("date");
	const tableSortDir = useSignal<FileSortDir>("desc");

	/**
	 * A failure that happened while APPENDING a page.
	 *
	 * Deliberately not `applyError`: that would flip the body to its error state and take the rows the
	 * person already has off the screen, which turns "the next page did not arrive" into "your files
	 * disappeared". A tail failure is reported under the grid, beside the rows it failed to extend.
	 */
	const tailError = useSignal<string | null>(null);

	const reqId = useRef(0);
	const simRef = useRef<FilesSim | undefined>(undefined);
	const workspaceRef = useRef<HTMLDivElement>(null);
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
			kinds: kindFilter.value.length > 0 ? kindFilter.value : undefined,
			sources: sourceFilter.value.length > 0 ? sourceFilter.value : undefined,
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
		const my = ++reqId.current;
		tailError.value = null;
		beginLoad();
		const res = await FilesService.list(listParams(null), simRef.current);
		if (my !== reqId.current) return;
		if (res.ok && res.data) applyPage(res.data);
		else applyError(res.message ?? "Those files could not be loaded.");
	}

	/** Append the next page. Guarded so a fast scroll cannot fire two requests for the same cursor. */
	async function loadMore(): Promise<void> {
		if (loadingMore.value || loading.value || !hasMore.value || !nextCursor.value) return;
		const my = reqId.current;
		loadingMore.value = true;
		const res = await FilesService.list(listParams(nextCursor.value), simRef.current);
		loadingMore.value = false;
		// A location change during the request supersedes this page entirely — appending it would mix
		// two folders' contents into one grid.
		if (my !== reqId.current) return;
		if (res.ok && res.data) {
			tailError.value = null;
			appendPage(res.data);
		} else {
			tailError.value = res.message ?? "The next page could not be loaded.";
		}
	}
	// #endregion

	// #region Navigation
	/**
	 * Move to a path, in place.
	 *
	 * The URL is pushed so a folder stays a real, shareable address (the submissions precedent) and the
	 * browser's Back button walks the folder history. Selection and the Inspect pane are cleared,
	 * because both describe assets that are about to stop being listed.
	 */
	function navigate(next: string[]): void {
		const href = assetHref(base, next);
		if (typeof history !== "undefined" && globalThis.location?.pathname !== href) {
			history.pushState({ filesPath: next }, "", href + globalThis.location.search);
		}
		currentPath.value = next;
		clearSelection();
		inspectId.value = null;
		void reload();
	}
	// #endregion

	// #region Selection
	/** The ids of the assets in the order they are painted — the run a shift-range is measured over. */
	function orderedAssetIds(): string[] {
		return items.value.map((asset) => asset.id);
	}

	function onSelect(asset: AssetItem, activation: AssetActivation): void {
		if (activation.range) rangeSelect(asset.id, orderedAssetIds());
		else if (activation.toggle) toggleSelect(asset.id);
		else selectOnly(asset.id);

		// Inspect follows the selection: a ctrl-click that REMOVED this asset must not leave the pane
		// describing something the person just deselected.
		inspectId.value = selection.value.includes(asset.id) ? asset.id : null;
	}

	/** Middle click — hand the raw asset to a new tab. `noopener` so the opened page cannot reach back. */
	function openRaw(asset: AssetItem): void {
		const target = asset.link?.url ?? asset.url;
		if (!target || target === "#") return;
		globalThis.open(target, "_blank", "noopener,noreferrer");
	}
	// #endregion

	// #region Mutations
	/** Re-read after a write, so the server's version of the library is what stays on screen. */
	async function afterWrite(message: string, ok: boolean): Promise<void> {
		busy.value = false;
		if (!ok) {
			applyError(message);
			return;
		}
		await reload();
	}

	async function moveInto(assetIds: string[], targetFolderId: string): Promise<void> {
		if (assetIds.length === 0) return;
		busy.value = true;
		const res = await FilesService.move({ assetIds, targetFolderId });
		await afterWrite(res.message ?? "Those files could not be moved.", res.ok);
	}

	async function setVisibility(asset: AssetItem, visibility: AssetVisibility): Promise<void> {
		busy.value = true;
		const res = await FilesService.setVisibility({
			assetIds: [asset.id],
			folderIds: [],
			visibility,
		});
		await afterWrite(res.message ?? "That privacy change could not be applied.", res.ok);
	}

	async function remove(asset: AssetItem): Promise<void> {
		busy.value = true;
		inspectId.value = null;
		const res = await FilesService.remove({ assetIds: [asset.id] });
		await afterWrite(res.message ?? "That file could not be deleted.", res.ok);
	}

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

	/**
	 * Star, optimistically and only locally.
	 *
	 * There is no star endpoint in the files contract yet, so this is honest session state rather than a
	 * write pretending to persist — it lands with the rest of the surface behind `FILES_BACKEND_LIVE`.
	 */
	function toggleStar(assetId: string): void {
		items.value = items.value.map((a) => (a.id === assetId ? { ...a, starred: !a.starred } : a));
	}

	/** Download: record the copy, then hand the bytes over. The guard/ledger is the server's business. */
	async function download(asset: AssetItem): Promise<void> {
		const target = asset.link?.url ?? asset.url;
		if (!target || target === "#") return;
		await FilesService.recordDownload({ assetId: asset.id, via: "hub" });
		globalThis.open(target, "_blank", "noopener,noreferrer");
	}
	// #endregion

	// #region Sort
	function applySort(key: FileSortKey): void {
		if (sortKey.value === key) {
			sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
		} else {
			sortKey.value = key;
			sortDir.value = "asc";
		}
		tableSortKey.value = sortKey.value;
		tableSortDir.value = sortDir.value;
		void reload();
	}
	// #endregion

	// #region Drag and drop
	function onDragEnd(e: DragEndEvent): void {
		if (e.canceled) return;
		const target = folderIdOfDrop(e.over);
		if (!target) return;
		const dragged = String(e.active.id);
		// A drag that started on a selected asset carries the whole selection; a drag from an unselected
		// one carries only itself, which is what a person who never selected anything means by it.
		const payload = selection.value.includes(dragged) ? [...selection.value] : [dragged];
		void moveInto(payload, target);
	}
	// #endregion

	// #region Mount
	useCtrlWheelZoom(workspaceRef, filesZoom);

	useEffect(() => {
		// Seed from SSR, in the browser, where these module-level signals belong to one tab. (SSR must
		// never write them: on the server the module is per-PROCESS, so a write would leak one request's
		// library into the next person's first paint.)
		currentPath.value = path;
		channelId.value = null;
		tree.value = initialTree;
		applyPage({ ...initial, tree: initialTree });
		tableSortKey.value = sortKey.value;
		tableSortDir.value = sortDir.value;

		// Every other region asks for a read through here, so there is one fetch path.
		filesCommit.value = () => void reload();

		simRef.current = simFromSeam();
		const unsubscribe = subscribeFilesSim((sim) => {
			simRef.current = sim;
			// The axes are SERVER-derived, so a re-render would only relabel the same rows — the read has
			// to happen again for the simulated projection to exist at all.
			void reload();
		});

		const onPop = () => {
			const next = globalThis.location.pathname
				.slice(base.replace(/\/+$/, "").length)
				.split("/")
				.filter(Boolean)
				.map((segment) => {
					try {
						return decodeURIComponent(segment);
					} catch {
						return segment;
					}
				});
			currentPath.value = next;
			clearSelection();
			inspectId.value = null;
			void reload();
		};
		globalThis.addEventListener("popstate", onPop);

		return () => {
			unsubscribe();
			globalThis.removeEventListener("popstate", onPop);
			filesCommit.value = null;
			// Module-level signals outlive this island, so a later navigation into another scope would
			// otherwise paint the previous library for a frame.
			resetFilesState();
		};
	}, []);
	// #endregion

	// #region Derived
	const inspected = inspectId.value
		? items.value.find((a) => a.id === inspectId.value) ?? null
		: null;

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

	const cells: Cell[] = [
		...folders.value.map((folder): Cell => ({ kind: "folder", folder })),
		...items.value.map((asset): Cell => ({ kind: "asset", asset })),
	];

	const isEmpty = seeded.value && cells.length === 0;
	const dragCount = selection.value.length;
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
				<div class="fh-state" role="status">
					<p class="fh-state__title">
						{narrowed.value ? "Nothing matches" : "Nothing here yet"}
					</p>
					<p class="fh-state__note">
						{narrowed.value
							? "No files or folders in this location match the current search and filters."
							: readOnly.value
							? "This location is empty. It is mounted here, so its contents are managed where they live."
							: "Files you upload, and links you save, will appear here."}
					</p>
					{narrowed.value
						? (
							<Button
								variant="text"
								size="sm"
								label="Clear filters"
								onClick={() => clearFilesFilters()}
							/>
						)
						: null}
				</div>
			);
		}

		return (
			<Workspace
				cells={cells}
				assets={items.value}
				folderList={folders.value}
				tableSortKey={tableSortKey}
				tableSortDir={tableSortDir}
				onSort={applySort}
				onSelect={onSelect}
				onPreview={(asset) => (previewId.value = asset.id)}
				onOpenRaw={openRaw}
				onOpenFolder={(folder) => navigate([...currentPath.value, folder.name])}
				onReachEnd={loadMore}
				busy={loadingMore.value}
				dragCount={dragCount}
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
							You can browse and attach from here. Changes are made where these files live.
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
		</div>
	);

	return (
		<div class="fh-hub" data-scope={currentScope.value} data-busy={busy.value || undefined}>
			<div class="fh-hub__crumbbar">
				<AssetBreadcrumbs
					crumbs={crumbs.value}
					base={base}
					onNavigate={navigate}
					aria-label="Folder path"
				/>
			</div>

			<DndContext onDragEnd={onDragEnd}>
				{inspected
					? (
						// `layout` is not decoration: `splitter.css` ships a BARE `.ui-splitter` rule that pins
						// the nav lane's width, and only the compound `.ui-splitter--horizontal` selector
						// outranks it. Without the modifier this pane collapses to a 280px lane.
						<Splitter layout="horizontal" class="fh-hub__split" stateKey="files-hub-inspect">
							<SplitterPanel size={72} minSize={45}>{workspace}</SplitterPanel>
							<SplitterPanel size={28} minSize={18} maxSize={42}>
								<InspectPanel
									asset={inspected}
									busy={busy.value}
									onClose={() => (inspectId.value = null)}
									onDownload={(asset) => void download(asset)}
									onOpenRaw={openRaw}
									onSetVisibility={(asset, visibility) => void setVisibility(asset, visibility)}
									onDelete={(asset) => void remove(asset)}
								/>
							</SplitterPanel>
						</Splitter>
					)
					: workspace}

				<DragOverlay class="fh-ghost">
					{dragCount > 1
						? <span class="fh-ghost__chip">{`${dragCount} files`}</span>
						: <span class="fh-ghost__chip">Move file</span>}
				</DragOverlay>
			</DndContext>

			<AttachmentPreviewModal
				open={previewAsset !== null}
				files={previewGroup}
				startIndex={previewIndex}
				viewerId={viewerId.value}
				projectId={subjectId.value ?? ""}
				onClose={() => (previewId.value = null)}
				onRename={(assetId, name) => void rename(assetId, name)}
				onToggleStar={toggleStar}
			/>
		</div>
	);
}
