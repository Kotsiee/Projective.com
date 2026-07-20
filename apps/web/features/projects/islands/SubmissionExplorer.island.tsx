import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/file-explorer.css";
import "../styles/submission-explorer.css";
import "../styles/submission-review.css";
import "../styles/file-card.css";
import "../styles/file-table.css";
import "../styles/submission-card.css";
import "../styles/attachment-modal.css";
import { VirtualGrid } from "@projective/ui/display";
import { InputText, MultiSelect, SortControl } from "@projective/ui/fields";
import type {
	FileItem,
	FileKind,
	FileSortDir,
	FileSortKey,
	SubmissionCrumb,
	SubmissionListPage,
	SubmissionReview,
	SubmissionTreeNode,
	SubmissionUnit,
} from "../types/projects-types.ts";
import { SubmissionsService } from "../core/SubmissionsService.ts";
import {
	FILE_KIND_OPTIONS,
	FILE_SORT_OPTIONS,
	groupIndexOf,
	messageGroup,
} from "../core/file-model.ts";
import {
	ancestorKeys,
	childNodesAt,
	nodeAt,
	nodeShowsChildCards,
	submissionHref,
	submissionsBase,
} from "../core/submission-model.ts";
import { closeReview, reviewOpen, setReviewable } from "../core/submissions-review.ts";
import {
	gridColWidth,
	nudgeZoom,
	restoreZoom,
	viewMode,
	zoom,
	ZOOM_WHEEL_STEP,
} from "../core/view-state.ts";
import { FileCard } from "../components/FileCard.tsx";
import { FileTable } from "../components/FileTable.tsx";
import { FreelancerCard } from "../components/FreelancerCard.tsx";
import { SubmissionCard } from "../components/SubmissionCard.tsx";
import { SubmissionNodeList } from "../components/SubmissionNodeList.tsx";
import { ROOT_KEY, SubmissionTree } from "../components/SubmissionTree.tsx";
import { SubmissionBreadcrumbs } from "../components/SubmissionBreadcrumbs.tsx";
import { AttachmentPreviewModal } from "../components/AttachmentPreviewModal.tsx";
import { SubmissionReviewModal } from "../components/SubmissionReviewModal.tsx";
import { SearchIcon } from "../components/file-glyphs.tsx";

/**
 * SubmissionExplorer — the Submissions workspace: the single island the `/submissions` routes mount. It
 * is the File Explorer canvas plus two additions (Part 2): a full-height navigation TREE on the left
 * (separated by a single vertical hairline) and an interactive BREADCRUMBS bar atop the workspace. The
 * grid⇄list presentation is selected by the shared {@link viewMode} (no toggle button); `Ctrl`+wheel
 * over the workspace drives {@link zoom}; both viewports are window-virtualized. Tree + breadcrumb
 * navigation re-scopes the workspace (a thin {@link SubmissionsService} refetch) and syncs the URL via
 * `history.pushState`, so a deep-linked node is shareable and back/forward works.
 *
 * When the current node resolves to a submission unit AND the viewer is the client, the footer's Review
 * Submission button (a separate island) is enabled via the shared review signals; opening it mounts the
 * {@link SubmissionReviewModal}. THIN: first paint is the SSR-resolved page; all refinement flows through
 * the thin service. Rename/star/accept/revision are optimistic — persistence lands with the backend.
 */
export interface SubmissionExplorerProps {
	scope: "channel" | "project";
	projectId: string;
	/** The channel id in channel scope; unused in project scope. */
	channelId?: string;
	initial: SubmissionListPage | null;
}

const GRID_GAP = 16;
const CARD_META = 62;

// #region Workspace view (zoom-reactive body)
interface WorkspaceViewProps {
	items: FileItem[];
	/** The current node's child nodes to render as drill-down cards (Part 3); empty when showing files. */
	nodes: SubmissionTreeNode[];
	/** Whether to render child-node cards (Freelancers/Submissions) instead of the file grid. */
	showNodes: boolean;
	isEmpty: boolean;
	hasFilters: boolean;
	sortKey: Signal<string>;
	sortDir: Signal<FileSortDir>;
	onSort: (key: FileSortKey) => void;
	onOpen: (file: FileItem) => void;
	onOpenNode: (node: SubmissionTreeNode) => void;
	onReachEnd: () => void;
	loadingMore: boolean;
}

/** Dispatch a child node to its card by kind (submitter → Freelancer, otherwise Submission/stage/dir). */
function nodeCard(node: SubmissionTreeNode, onOpen: (n: SubmissionTreeNode) => void): JSX.Element {
	return node.kind === "submitter"
		? <FreelancerCard node={node} onOpen={onOpen} />
		: <SubmissionCard node={node} onOpen={onOpen} />;
}

function WorkspaceView(p: WorkspaceViewProps): JSX.Element {
	// Drill-down mode: the current node's children are shown as navigable cards / rows.
	if (p.showNodes) {
		if (p.nodes.length === 0) {
			return (
				<div class="fx-empty" role="status">
					<p class="fx-empty__title">Nothing submitted yet</p>
					<p class="fx-empty__note">
						{p.hasFilters
							? "No submissions match the current search and filters."
							: "Freelancers who submit deliverables will appear here."}
					</p>
				</div>
			);
		}
		if (viewMode.value === "grid") {
			return (
				<VirtualGrid
					items={p.nodes}
					minColWidth={gridColWidth(zoom.value)}
					rowHeight={(w) => w + CARD_META + GRID_GAP}
					gap={GRID_GAP}
					useWindow
					overscan={3}
					getItemKey={(n) => n.segment}
					aria-label="Submissions"
					itemTemplate={(n) => nodeCard(n, p.onOpenNode)}
				/>
			);
		}
		return <SubmissionNodeList nodes={p.nodes} onOpen={p.onOpenNode} />;
	}

	// Leaf mode: the node's deliverable files.
	if (p.isEmpty) {
		return (
			<div class="fx-empty" role="status">
				<p class="fx-empty__title">No files here</p>
				<p class="fx-empty__note">
					{p.hasFilters
						? "No files match the current search and filters."
						: "Deliverables submitted to this node will appear here."}
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
				aria-label="Submitted files"
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
// #endregion

export default function SubmissionExplorer(props: SubmissionExplorerProps): JSX.Element {
	const { scope, projectId, channelId, initial } = props;
	const base = submissionsBase(scope, projectId, channelId);

	// #region State
	const items = useSignal<FileItem[]>(initial?.items ?? []);
	// The navigation tree + root labelling are scope-constant (filter-independent counts) — set once.
	const tree = useSignal<SubmissionTreeNode[]>(initial?.tree ?? []);
	const rootLabel = initial?.scope === "channel" ? "Submissions" : "All stages";
	const rootCount = (initial?.tree ?? []).reduce((s, n) => s + n.fileCount, 0);

	const path = useSignal<string[]>(initial?.path ?? []);
	const breadcrumbs = useSignal<SubmissionCrumb[]>(initial?.breadcrumbs ?? []);
	const activeUnit = useSignal<SubmissionUnit | null>(initial?.activeUnit ?? null);
	const review = useSignal<SubmissionReview | null>(initial?.review ?? null);
	const cursor = useSignal<string | null>(initial?.nextCursor ?? null);
	const hasMore = useSignal<boolean>(initial?.hasMore ?? false);
	const total = useSignal<number>(initial?.total ?? 0);
	const viewerId = initial?.viewerId ?? "viewer";
	const viewerIsClient = initial?.viewerIsClient ?? false;

	const expanded = useSignal<Set<string>>(
		new Set([ROOT_KEY, ...ancestorKeys(initial?.path ?? [])]),
	);

	const query = useSignal("");
	const sortKey = useSignal<string>("date");
	const sortDir = useSignal<FileSortDir>("desc");
	const filterKinds = useSignal<string[]>([]);

	const loading = useSignal(false);
	const loadingMore = useSignal(false);
	const openId = useSignal<string | null>(null);

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Data loading
	function baseParams(nextPath: string[], nextCursor: string | null) {
		return {
			projectId,
			channelId: scope === "channel" ? (channelId ?? null) : null,
			path: nextPath.length ? nextPath : undefined,
			// An empty key is the 3rd sort state ("none") — omit `sort` for the backend default order.
			sort: sortKey.value ? (sortKey.value as FileSortKey) : undefined,
			dir: sortDir.value,
			kinds: filterKinds.value.length ? (filterKinds.value as FileKind[]) : undefined,
			query: query.value || undefined,
			cursor: nextCursor,
		};
	}

	async function reload(nextPath: string[]): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		const res = await SubmissionsService.list(baseParams(nextPath, null));
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			const page = res.data.page;
			items.value = page.items;
			breadcrumbs.value = page.breadcrumbs;
			activeUnit.value = page.activeUnit;
			review.value = page.review;
			cursor.value = page.nextCursor;
			hasMore.value = page.hasMore;
			total.value = page.total;
			// Trust the server's resolved path (a bad segment degrades to the deepest valid node).
			path.value = page.path;
		}
	}

	async function loadMore(): Promise<void> {
		if (loadingMore.value || loading.value || !hasMore.value || !cursor.value) return;
		const my = reqId.current;
		loadingMore.value = true;
		const res = await SubmissionsService.list(baseParams(path.value, cursor.value));
		loadingMore.value = false;
		if (my !== reqId.current) return;
		if (res.ok && res.data) {
			items.value = [...items.value, ...res.data.page.items];
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
		}
	}
	// #endregion

	// #region Navigation (tree + breadcrumbs → refetch + pushState)
	function navigate(nextPath: string[], push = true): void {
		path.value = nextPath;
		expanded.value = new Set([ROOT_KEY, ...expanded.value, ...ancestorKeys(nextPath)]);
		if (push && typeof history !== "undefined") {
			history.pushState({ subm: nextPath }, "", submissionHref(base, nextPath));
		}
		void reload(nextPath);
	}

	function pathFromUrl(): string[] {
		if (typeof location === "undefined") return path.value;
		let rest = location.pathname;
		if (rest.startsWith(base)) rest = rest.slice(base.length);
		return rest.split("/").map((s) => s.trim()).filter(Boolean).map(decodeURIComponent);
	}
	// #endregion

	// #region Toolbar handlers
	function onSearch(v: string): void {
		query.value = v;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => void reload(path.value), 300) as unknown as number;
	}
	// 3-state single-column sort: asc → desc → none (multi-column sort stays disabled for Submissions).
	function applySort(key: FileSortKey): void {
		if (sortKey.value === key) {
			if (sortDir.value === "asc") sortDir.value = "desc";
			else sortKey.value = ""; // desc → none: clear the active column (default order)
		} else {
			sortKey.value = key;
			sortDir.value = "asc";
		}
		void reload(path.value);
	}
	function onFilter(kinds: string[]): void {
		filterKinds.value = kinds;
		void reload(path.value);
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

	// #region Review flow (optimistic)
	function updateActiveStatus(status: SubmissionUnit["status"]): void {
		if (activeUnit.value) activeUnit.value = { ...activeUnit.value, status };
		if (review.value) {
			review.value = { ...review.value, unit: { ...review.value.unit, status } };
		}
	}
	function onRequestRevision(): void {
		updateActiveStatus("revision_requested");
		closeReview();
	}
	function onAccept(): void {
		updateActiveStatus("accepted");
		closeReview();
	}
	// #endregion

	// #region Effects
	// Restore zoom + Ctrl+wheel over the workspace.
	useEffect(() => {
		restoreZoom();
		const el = workspaceRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			nudgeZoom(e.deltaY < 0 ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	// Back/forward — re-scope to the URL's path without pushing a new entry.
	useEffect(() => {
		const onPop = () => navigate(pathFromUrl(), false);
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);

	// Publish the reviewable state to the footer's Review Submission button; reset on unmount.
	useEffect(() => {
		setReviewable(viewerIsClient && activeUnit.value !== null, activeUnit.value?.name ?? "");
	}, [activeUnit.value, viewerIsClient]);
	useEffect(() => () => setReviewable(false, ""), []);
	// #endregion

	const isEmpty = items.value.length === 0 && !loading.value;
	const hasFilters = !!(query.value || filterKinds.value.length);

	// Part 3 drill-down: at the scope root / a stage / a freelancer, render the current node's children
	// as Freelancer/Submission cards; a unit or dir shows its files. An active search/filter falls back
	// to the flattened file results at any level so search still finds matching files.
	const currentNode = nodeAt(tree.value, path.value);
	const showNodes = nodeShowsChildCards(currentNode) && !hasFilters;
	const childNodes = showNodes ? childNodesAt(tree.value, path.value) : [];

	const workspaceView = (
		<WorkspaceView
			items={items.value}
			nodes={childNodes}
			showNodes={showNodes}
			isEmpty={isEmpty}
			hasFilters={hasFilters}
			sortKey={sortKey}
			sortDir={sortDir}
			onSort={applySort}
			onOpen={open}
			onOpenNode={(n) => navigate([...path.value, n.segment])}
			onReachEnd={loadMore}
			loadingMore={loadingMore.value}
		/>
	);

	function toolbar(): JSX.Element {
		return (
			<div class="fx-toolbar subm-toolbar">
				<div class="fx-toolbar__search">
					<InputText
						type="search"
						variant="bare"
						size="sm"
						block
						placeholder="Search submissions…"
						aria-label="Search submissions"
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
					onValueChange={() => void reload(path.value)}
					onDirectionChange={() => void reload(path.value)}
				/>
			</div>
		);
	}

	return (
		<div class="subm-explorer" data-scope={scope}>
			<div class="subm-layout">
				<aside class="subm-aside-tree" aria-label="Submission navigator">
					<SubmissionTree
						tree={tree.value}
						rootLabel={rootLabel}
						rootCount={rootCount}
						currentPath={path.value}
						expanded={expanded}
						onNavigate={(p) => navigate(p)}
					/>
				</aside>
				<div class="subm-main">
					<div class="subm-bar">
						<div class="subm-crumbbar">
							<SubmissionBreadcrumbs
								crumbs={breadcrumbs.value}
								base={base}
								onNavigate={(p) => navigate(p)}
							/>
						</div>
						{toolbar()}
					</div>
					<div class="fx-workspace" ref={workspaceRef}>{workspaceView}</div>
				</div>
			</div>

			<AttachmentPreviewModal
				open={!!openFile}
				files={group}
				startIndex={startIndex}
				viewerId={viewerId}
				projectId={projectId}
				notesMode
				onClose={() => (openId.value = null)}
				onRename={renameFile}
				onToggleStar={toggleStar}
			/>

			<SubmissionReviewModal
				open={reviewOpen.value}
				review={review.value}
				files={items.value}
				tree={tree.value}
				rootLabel={rootLabel}
				rootCount={rootCount}
				currentPath={path.value}
				expanded={expanded}
				viewerId={viewerId}
				onClose={closeReview}
				onNavigate={(p) => navigate(p)}
				onRequestRevision={onRequestRevision}
				onAccept={onAccept}
			/>
		</div>
	);
}
