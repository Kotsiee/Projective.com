import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/file-explorer.css";
import "../styles/submission-explorer.css";
import "../styles/submission-review.css";
import "../styles/submission-actions.css";
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
	SubmissionStatus,
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
	submissionTickets,
} from "../core/submission-model.ts";
import {
	type DevSeamState,
	effectiveFormat,
	effectiveHasTasks,
	effectiveUnitStatus,
	fulfilsTickets,
	readDevSeam,
	resolveViewer,
	resolveWorkflowActions,
	watchDevSeam,
} from "../core/submission-access.ts";
import {
	closeTasksPanel,
	setTasksAvailable,
	tasksPanelOpen,
} from "../core/submission-workspace.ts";
import {
	buildTaskChecklist,
	type TaskChecklist,
	toggleChecklistItem,
} from "../core/submission-tasks.ts";
import { wantsReview } from "../core/ticket-view.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { filesZoom, gridColWidth, viewMode, zoom } from "../core/view-state.ts";
import { FileCard } from "../components/FileCard.tsx";
import { FileTable } from "../components/FileTable.tsx";
import { FreelancerCard } from "../components/FreelancerCard.tsx";
import { SubmissionCard } from "../components/SubmissionCard.tsx";
import { SubmissionNodeList } from "../components/SubmissionNodeList.tsx";
import { ROOT_KEY, SubmissionTree } from "../components/SubmissionTree.tsx";
import { SubmissionBreadcrumbs } from "../components/SubmissionBreadcrumbs.tsx";
import { SubmissionActionBar } from "../components/SubmissionActionBar.tsx";
import { AttachmentPreviewModal } from "../components/AttachmentPreviewModal.tsx";
import { SubmissionReviewModal } from "../components/SubmissionReviewModal.tsx";
import { CreateSubmissionModal } from "../components/CreateSubmissionModal.tsx";
import { UploadFilesModal } from "../components/UploadFilesModal.tsx";
import { DeleteSubmissionDialog } from "../components/DeleteSubmissionDialog.tsx";
import { PreSubmitModal } from "../components/PreSubmitModal.tsx";
import { TasksPanel } from "../components/TasksPanel.tsx";
import { SearchIcon } from "../components/file-glyphs.tsx";

/**
 * SubmissionExplorer — the Submissions workspace: the single island the `/submissions` routes mount. It
 * is the File Explorer canvas plus a full-height navigation TREE (left, single vertical hairline) and an
 * interactive BREADCRUMBS bar; the grid⇄list presentation is selected by the shared {@link viewMode} (no
 * toggle button) and both viewports are window-virtualized.
 *
 * On top of the read surface it owns the full role-sensitive submission workflow (root task §2–§6): the
 * effective viewer + submission state are resolved from the real SSR data layered with the (dev-only)
 * Context Switcher overrides ({@link resolveViewer}), so every control live-updates when the developer
 * flips a persona/state (§7). A freelancer's tree/files are isolated to their OWN submissions server-side
 * (an `asFreelancer` refetch on a persona flip). The crumb-bar hosts the action state machine
 * ({@link SubmissionActionBar}) — Review · Create · Upload/Delete/Submit · status badge — and the modals
 * those fire; the footer's Tasks toggle reveals the {@link TasksPanel}, whose checklist is shared with the
 * freelancer's Pre-Submit modal. All transitions are optimistic — persistence lands with the backend.
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
	// The navigation tree + root labelling are scope-constant (filter-independent counts) — set on reload.
	const tree = useSignal<SubmissionTreeNode[]>(initial?.tree ?? []);
	const rootLabel = initial?.scope === "channel" ? "Submissions" : "All stages";

	const path = useSignal<string[]>(initial?.path ?? []);
	const breadcrumbs = useSignal<SubmissionCrumb[]>(initial?.breadcrumbs ?? []);
	const activeUnit = useSignal<SubmissionUnit | null>(initial?.activeUnit ?? null);
	const review = useSignal<SubmissionReview | null>(initial?.review ?? null);
	const cursor = useSignal<string | null>(initial?.nextCursor ?? null);
	const hasMore = useSignal<boolean>(initial?.hasMore ?? false);
	const total = useSignal<number>(initial?.total ?? 0);
	// Viewer identity + role — updated on every reload (an `asFreelancer` refetch flips them).
	const viewerId = useSignal<string>(initial?.viewerId ?? "viewer");
	const viewerIsClient = useSignal<boolean>(initial?.viewerIsClient ?? false);
	const projectTitle = initial?.projectTitle ?? "this project";
	const baseFormat = initial?.format ?? "pipeline";

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

	// The DEV Context Switcher override (null = the real session); tracked so capabilities live-update.
	const seam = useSignal<DevSeamState | null>(null);
	// The freelancer's in-progress, self-created draft submission (before it exists in the tree).
	const localDraft = useSignal<{ name: string; status: SubmissionStatus } | null>(null);
	// The shared stage/ticket task checklist (bound by both the Tasks panel and the Pre-Submit modal).
	const checklist = useSignal<TaskChecklist>(buildTaskChecklist(base, { hasTickets: true }));

	// Workflow modal / dialog visibility.
	const reviewOpen = useSignal(false);
	const createOpen = useSignal(false);
	const uploadOpen = useSignal(false);
	const deleteOpen = useSignal(false);
	const preSubmitOpen = useSignal(false);

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Effective workflow (SSR baseline ⊕ dev override)
	const viewer = resolveViewer(viewerIsClient.value, seam.value);
	const format = effectiveFormat(baseFormat, seam.value);
	const hasTasks = effectiveHasTasks(true, seam.value);
	// The active submission: a real tree unit (dev status override applies) OR a self-created draft.
	const hasActiveUnit = activeUnit.value !== null || localDraft.value !== null;
	const effStatus: SubmissionStatus | null = activeUnit.value
		? effectiveUnitStatus(activeUnit.value.status, viewer, seam.value)
		: (localDraft.value ? localDraft.value.status : null);
	const workflow = resolveWorkflowActions({ viewer, hasActiveUnit, effectiveStatus: effStatus });

	const rootCount = (tree.value ?? []).reduce((s, n) => s + n.fileCount, 0);
	// The active stage's name — a real stage crumb (the synthetic root crumb also carries kind "stage"
	// but a zero-length path, so it must be excluded).
	const currentStageName =
		breadcrumbs.value.find((c) => c.kind === "stage" && c.path.length > 0)?.label ?? null;
	const seedKey = `${projectId}:${channelId ?? ""}:${path.value.join("/")}`;
	const tickets = submissionTickets(seedKey, { hasTickets: fulfilsTickets(format) });
	const draftName = localDraft.value?.name ?? activeUnit.value?.name ?? "Submission";
	// #endregion

	// #region Data loading
	/** The isolation flag to send: under a dev override, follow the simulated freelancer/reviewer role. */
	function asFreelancerParam(): boolean | undefined {
		return seam.value ? resolveViewer(viewerIsClient.value, seam.value).isFreelancer : undefined;
	}

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
			asFreelancer: asFreelancerParam(),
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
			tree.value = page.tree;
			breadcrumbs.value = page.breadcrumbs;
			activeUnit.value = page.activeUnit;
			review.value = page.review;
			cursor.value = page.nextCursor;
			hasMore.value = page.hasMore;
			total.value = page.total;
			viewerId.value = page.viewerId;
			viewerIsClient.value = page.viewerIsClient;
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

	// #region Review flow (reviewer — optimistic)
	function updateActiveStatus(status: SubmissionUnit["status"]): void {
		if (activeUnit.value) activeUnit.value = { ...activeUnit.value, status };
		if (review.value) {
			review.value = { ...review.value, unit: { ...review.value.unit, status } };
		}
	}
	function onRequestRevision(): void {
		updateActiveStatus("revision_requested");
		reviewOpen.value = false;
	}
	function onAccept(): void {
		updateActiveStatus("accepted");
		reviewOpen.value = false;
	}
	// #endregion

	// #region Freelancer workflow actions (create · upload · delete · submit — optimistic stubs)
	function onCreateSubmission(payload: { name: string }): void {
		localDraft.value = { name: payload.name, status: "draft" };
		createOpen.value = false;
	}
	function onDeleteSubmission(): void {
		deleteOpen.value = false;
		if (localDraft.value) {
			localDraft.value = null;
		} else if (path.value.length > 0) {
			// A real (self-owned) unit — navigate back to its parent (removal persists with the backend).
			navigate(path.value.slice(0, -1));
		}
	}
	function onConfirmSubmit(): void {
		preSubmitOpen.value = false;
		if (localDraft.value) {
			localDraft.value = { ...localDraft.value, status: "pending_review" };
		} else {
			updateActiveStatus("pending_review");
		}
	}
	function toggleTask(id: string): void {
		checklist.value = toggleChecklistItem(checklist.value, id);
	}
	// #endregion

	// #region Effects
	// Restore zoom + Ctrl+wheel over the workspace.
	useCtrlWheelZoom(workspaceRef, filesZoom);

	// Back/forward — re-scope to the URL's path without pushing a new entry.
	useEffect(() => {
		const onPop = () => navigate(pathFromUrl(), false);
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);

	// Track the DEV Context Switcher: recompute capabilities live, and re-fetch with the new isolation
	// when the effective freelancer/reviewer perspective changes (root task §2 + §7).
	useEffect(() => {
		const sync = () => {
			const prev = seam.value;
			const next = readDevSeam();
			const prevFree = prev
				? resolveViewer(viewerIsClient.value, prev).isFreelancer
				: !viewerIsClient.value;
			const nextFree = next
				? resolveViewer(viewerIsClient.value, next).isFreelancer
				: !viewerIsClient.value;
			seam.value = next;
			if (prevFree !== nextFree) {
				localDraft.value = null; // a role flip discards any in-progress simulated draft
				void reload(path.value);
			}
		};
		sync();
		return watchDevSeam(sync);
	}, []);

	// Rebuild the task checklist when the node / format changes (resets the freelancer's ticks).
	useEffect(() => {
		checklist.value = buildTaskChecklist(seedKey, { hasTickets: fulfilsTickets(format) });
	}, [seedKey, format]);

	/*
	 * The hand-off from the ticket modal (root CLAUDE.md §8 Decision #65). A review opened inside a
	 * ticket rewrites the URL to this route with `?review=1`, so a link copied mid-review REOPENS the
	 * review here rather than merely landing on the submission. The marker is then stripped from the
	 * URL, because it describes an arrival and re-running it on every Back would be wrong.
	 *
	 * Gated on the resolved reviewer role, so a freelancer following the same link sees their files
	 * rather than a review workspace they cannot act in.
	 */
	useEffect(() => {
		if (typeof location === "undefined") return;
		if (!wantsReview(location.search)) return;
		if (!review.value || !viewer.isReviewer) return;
		reviewOpen.value = true;
		history.replaceState(history.state, "", location.pathname);
	}, [review.value?.unit.path.join("/"), viewer.isReviewer]);

	// Publish Tasks-panel availability to the footer toggle; reset on unmount.
	useEffect(() => {
		setTasksAvailable(hasTasks);
	}, [hasTasks]);
	useEffect(() => () => {
		setTasksAvailable(false);
		closeTasksPanel();
	}, []);
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
			<div class="subm-layout" data-tasks={tasksPanelOpen.value ? "open" : undefined}>
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
							<div class="subm-crumbbar__trail">
								<SubmissionBreadcrumbs
									crumbs={breadcrumbs.value}
									base={base}
									onNavigate={(p) => navigate(p)}
								/>
							</div>
							<SubmissionActionBar
								actions={workflow}
								onReview={() => (reviewOpen.value = true)}
								onCreate={() => (createOpen.value = true)}
								onUpload={() => (uploadOpen.value = true)}
								onDelete={() => (deleteOpen.value = true)}
								onSubmit={() => (preSubmitOpen.value = true)}
							/>
						</div>
						{toolbar()}
					</div>
					<div class="fx-workspace" ref={workspaceRef}>{workspaceView}</div>
				</div>
				{tasksPanelOpen.value
					? (
						<TasksPanel
							checklist={checklist.value}
							onToggle={toggleTask}
							onClose={closeTasksPanel}
						/>
					)
					: null}
			</div>

			<AttachmentPreviewModal
				open={!!openFile}
				files={group}
				startIndex={startIndex}
				viewerId={viewerId.value}
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
				viewerId={viewerId.value}
				onClose={() => (reviewOpen.value = false)}
				onNavigate={(p) => navigate(p)}
				onRequestRevision={onRequestRevision}
				onAccept={onAccept}
			/>

			<CreateSubmissionModal
				open={createOpen.value}
				projectTitle={projectTitle}
				stageName={currentStageName}
				tickets={tickets}
				onClose={() => (createOpen.value = false)}
				onCreate={onCreateSubmission}
			/>

			<UploadFilesModal
				open={uploadOpen.value}
				submissionName={draftName}
				onClose={() => (uploadOpen.value = false)}
			/>

			<DeleteSubmissionDialog
				open={deleteOpen.value}
				name={draftName}
				onClose={() => (deleteOpen.value = false)}
				onConfirm={onDeleteSubmission}
			/>

			<PreSubmitModal
				open={preSubmitOpen.value}
				submissionName={draftName}
				files={items.value}
				checklist={checklist.value}
				onToggle={toggleTask}
				onClose={() => (preSubmitOpen.value = false)}
				onConfirm={onConfirmSubmit}
			/>
		</div>
	);
}
