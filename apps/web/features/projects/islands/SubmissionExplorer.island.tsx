import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/fx-toolbar.css";
import "../styles/file-explorer.css";
import "../styles/submission-explorer.css";
import "../styles/submission-review.css";
import "../styles/submission-actions.css";
import "../styles/file-card.css";
import "../styles/file-table.css";
import "../styles/submission-card.css";
import "../styles/attachment-modal.css";
import { VirtualGrid } from "@projective/ui/display";
import { Message } from "@projective/ui/feedback";
import { InputText, MultiSelect, SortControl } from "@projective/ui/fields";
import type {
	AssetItem,
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
import {
	filesZoom,
	gridColWidth,
	listRowHeight,
	listShowsThumbnails,
	viewMode,
	zoom,
} from "../core/view-state.ts";
import { ProjectSkeleton, useSkeletonDelay } from "../components/ProjectSkeletons.tsx";
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
import {
	CreateSubmissionModal,
	type CreateSubmissionPayload,
} from "../components/CreateSubmissionModal.tsx";
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
/** Placeholder extent floor/ceiling — enough to fill a viewport without drawing a whole corpus. */
const SKELETON_MIN = 8;
const SKELETON_MAX = 24;

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
	onOpen: (file: AssetItem) => void;
	onOpenNode: (node: SubmissionTreeNode) => void;
	onReachEnd: () => void;
	loadingMore: boolean;
	/** A refine has been pending long enough to be worth drawing (the delay gate, not the raw flag). */
	loading: boolean;
	/** How many placeholders to draw — the outgoing item count, so a refine redraws at that extent. */
	skeletonCount: number;
}

/** Dispatch a child node to its card by kind (submitter → Freelancer, otherwise Submission/stage/dir). */
function nodeCard(node: SubmissionTreeNode, onOpen: (n: SubmissionTreeNode) => void): JSX.Element {
	return node.kind === "submitter"
		? <FreelancerCard node={node} onOpen={onOpen} />
		: <SubmissionCard node={node} onOpen={onOpen} />;
}

/**
 * The loading placeholder, resolved through the SAME two branches the real body is
 * ({@link showNodes} then {@link viewMode}) and configured from the same expressions — so whichever
 * viewport is about to render, the placeholder standing in for it occupies an identical box.
 */
function workspaceSkeleton(p: WorkspaceViewProps): JSX.Element {
	if (viewMode.value === "grid") {
		// Node cards and file cards share the VirtualGrid parameters AND the 62px meta strip, so one
		// grid placeholder is exact for both.
		return (
			<ProjectSkeleton
				shape="grid"
				label="Loading submissions…"
				count={p.skeletonCount}
				colWidth={gridColWidth(zoom.value)}
				gap={GRID_GAP}
				metaHeight={CARD_META}
			/>
		);
	}
	if (p.showNodes) {
		return (
			<ProjectSkeleton shape="node-list" label="Loading submissions…" count={p.skeletonCount} />
		);
	}
	return (
		<ProjectSkeleton
			shape="list"
			label="Loading submissions…"
			count={p.skeletonCount}
			rowHeight={listRowHeight(zoom.value)}
			thumbnails={listShowsThumbnails(zoom.value)}
		/>
	);
}

function WorkspaceView(p: WorkspaceViewProps): JSX.Element {
	if (p.loading) return workspaceSkeleton(p);

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
	/** The stage this scope anchors deliveries to — scope-constant, so it is read once, not tracked. */
	const stageAnchor = initial?.stageId ?? null;

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
	/**
	 * The placeholder gate. `loading` still suppresses the empty state the moment a request starts;
	 * this only decides whether the wait has been long enough to draw, so the stubbed backend (which
	 * resolves within a tick) never strobes a skeleton on every debounced keystroke or tree click.
	 */
	const skeleton = useSkeletonDelay();

	// The DEV Context Switcher override (null = the real session); tracked so capabilities live-update.
	const seam = useSignal<DevSeamState | null>(null);
	// The freelancer's in-progress, self-created draft submission (before it exists in the tree).
	/**
	 * The submission currently being assembled.
	 *
	 * `id` is null only while the row does not exist yet — the modal opens a placeholder before the
	 * create round-trips. Once the server answers, its id is held here, because "send this for review"
	 * has to name the draft it is sending: without an id the endpoint can only insert, and the same
	 * delivery is filed twice.
	 */
	const localDraft = useSignal<
		{ id: string | null; name: string; status: SubmissionStatus } | null
	>(null);
	// The shared stage/ticket task checklist (bound by both the Tasks panel and the Pre-Submit modal).
	const checklist = useSignal<TaskChecklist>(buildTaskChecklist(base, { hasTickets: true }));

	// Workflow modal / dialog visibility.
	const reviewOpen = useSignal(false);
	const createOpen = useSignal(false);
	const uploadOpen = useSignal(false);
	const deleteOpen = useSignal(false);
	const preSubmitOpen = useSignal(false);
	/**
	 * Deliverables picked from the freelancer's own library in the pre-submit review.
	 *
	 * Held HERE rather than inside the modal because this island owns what will be submitted: a modal
	 * that staged its own picks would show a file the submission does not contain, and the count in its
	 * summary would stop being a fact. Session-local and optimistic like every other write on this
	 * surface, pending `PROJECTS_BACKEND_LIVE`.
	 */
	const libraryPicks = useSignal<AssetItem[]>([]);
	/** A create/submit write is in flight — held so one press cannot become two submissions. */
	const workflowBusy = useSignal(false);
	/**
	 * Why the last create/submit did not land.
	 *
	 * Rendered in the sticky bar rather than as a toast: a refused delivery leaves the surface looking
	 * exactly as it did when it succeeded, so the statement has to stay on screen next to the control
	 * that produced it until the person dismisses it.
	 */
	const workflowError = useSignal<string | null>(null);

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
		skeleton.begin();
		const res = await SubmissionsService.list(baseParams(nextPath, null));
		// A superseded request leaves both flags alone: the request that replaced it owns them, and
		// clearing here would drop the placeholder back to stale rows mid-flight.
		if (my !== reqId.current) return;
		loading.value = false;
		// Cleared BEFORE the payload check, so a failed refine surfaces its stale rows again rather
		// than leaving the placeholder up for the life of the page.
		skeleton.end();
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
	function open(file: AssetItem): void {
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

	// #region Freelancer workflow actions (create · upload · delete · submit)
	/**
	 * The stage a new submission is anchored to.
	 *
	 * In CHANNEL scope it is the server-resolved anchor. A channel id and a stage id are different
	 * identifiers — the URL carries `stage-2` while `projects.stage_submissions.stage_id` wants the
	 * stage's own uuid — so this cannot be inferred from the route, and passing the channel id here
	 * refused every create. It is null on a general channel, which has no deliverables to anchor.
	 *
	 * In PROJECT scope it is the stage crumb — the synthetic root crumb also carries kind `stage` but a
	 * zero-length path, so it has to be excluded — with the resolved unit's own stage as the fallback
	 * for a node deeper than the trail.
	 */
	function activeStageId(): string | null {
		if (scope === "channel") return stageAnchor ?? activeUnit.value?.stageId ?? null;
		const crumb = breadcrumbs.value.find((c) => c.kind === "stage" && c.path.length > 0);
		return crumb?.path[0] ?? activeUnit.value?.stageId ?? null;
	}

	/** The checklist lines this delivery claims to satisfy — completion is claimed here, not on the ticket. */
	function checkedItemIds(): string[] {
		return [...checklist.value.stage, ...checklist.value.ticket]
			.filter((item) => item.done)
			.map((item) => item.id);
	}

	/**
	 * Adopt the unit the server created, replacing the local draft that stood in for it.
	 *
	 * The tree is reloaded rather than patched: a new unit changes the navigator, the file counts and
	 * the crumb trail, and a surface that showed the submission only in the one place this tab happened
	 * to write it would be telling the freelancer their delivery exists in a way nobody else can see.
	 */
	function adoptUnit(unit: SubmissionUnit): void {
		// The unit's path is a segment chain ending in the submission's own id (`live-submissions.ts`).
		localDraft.value = {
			id: unit.path[unit.path.length - 1] ?? null,
			name: unit.name,
			status: unit.status,
		};
		void reload(path.value);
	}

	/**
	 * Create the submission unit.
	 *
	 * `submit: false` — this is a private working copy. The draft appears immediately so the freelancer
	 * can start attaching to it, and is withdrawn again if the write is refused, because a draft nobody
	 * can add a file to is worse than no draft at all.
	 */
	async function onCreateSubmission(payload: CreateSubmissionPayload): Promise<void> {
		createOpen.value = false;
		if (workflowBusy.value) return;
		const stageId = activeStageId();
		if (!stageId) {
			workflowError.value = "Open a stage before creating a submission.";
			return;
		}
		localDraft.value = { id: null, name: payload.name, status: "draft" };
		workflowError.value = null;
		workflowBusy.value = true;
		const res = await SubmissionsService.create({
			projectId,
			channelId: scope === "channel" ? channelId ?? null : null,
			stageId,
			ticketId: payload.ticketId,
			title: payload.name,
			description: "",
			submissionId: null,
			checkedItemIds: [],
			fileIds: [],
			submit: false,
		});
		workflowBusy.value = false;
		if (res.ok && res.data) {
			adoptUnit(res.data.unit);
			return;
		}
		localDraft.value = null;
		workflowError.value = res.message ?? "That submission could not be created.";
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
	/** Stage picked library assets onto the pending submission, ignoring ones already staged. */
	function addLibraryPicks(assets: AssetItem[]): void {
		if (assets.length === 0) return;
		const known = new Set([
			...items.value.map((f) => f.id),
			...libraryPicks.value.map((a) => a.id),
		]);
		const next = assets.filter((a) => !known.has(a.id));
		if (next.length === 0) return;
		libraryPicks.value = [...libraryPicks.value, ...next];
	}

	/**
	 * Submit for review — the delivery claim that starts the client's clock.
	 *
	 * The staged library picks travel as `fileIds`; they are already `files.items` ids, so there is
	 * nothing to upload. This surface has no device-file source to upload FROM: `UploadFilesModal` is a
	 * drop target with no input behind it yet, and building an upload branch over a permanently empty
	 * list would be a code path nothing on the surface can reach.
	 *
	 * A draft that already exists server-side is sent by NAMING it (`submissionId`), which the endpoint
	 * turns into a status transition. Posting without the id inserts, so the same delivery would be
	 * filed twice — once as the draft and once as the submission.
	 */
	async function onConfirmSubmit(): Promise<void> {
		preSubmitOpen.value = false;
		if (workflowBusy.value) return;
		const draft = localDraft.value;
		if (!draft) {
			libraryPicks.value = [];
			updateActiveStatus("pending_review");
			return;
		}

		const stageId = activeStageId();
		if (!stageId) {
			workflowError.value = "Open a stage before submitting.";
			return;
		}
		// Held rather than dropped: a refused submission has to be able to put them back, or the
		// freelancer re-picks every deliverable to retry.
		const picks = libraryPicks.value;
		libraryPicks.value = [];
		localDraft.value = { ...draft, status: "pending_review" };
		workflowError.value = null;
		workflowBusy.value = true;
		const res = await SubmissionsService.create({
			projectId,
			channelId: scope === "channel" ? channelId ?? null : null,
			stageId,
			ticketId: activeUnit.value?.ticketId ?? null,
			// Present once the draft exists server-side, which turns this into a transition. Null only for
			// a placeholder whose create never landed, where inserting is the correct thing to do.
			submissionId: draft.id,
			title: draft.name,
			description: "",
			checkedItemIds: checkedItemIds(),
			fileIds: picks.map((asset) => asset.id),
			submit: true,
		});
		workflowBusy.value = false;
		if (res.ok && res.data) {
			adoptUnit(res.data.unit);
			return;
		}
		localDraft.value = draft;
		libraryPicks.value = picks;
		workflowError.value = res.message ?? "That submission could not be sent for review.";
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
			loading={skeleton.visible.value}
			skeletonCount={Math.min(
				Math.max(showNodes ? childNodes.length : items.value.length, SKELETON_MIN),
				SKELETON_MAX,
			)}
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
						{workflowError.value && (
							<Message
								severity="danger"
								variant="subtle"
								size="sm"
								closable
								onClose={() => (workflowError.value = null)}
							>
								{workflowError.value}
							</Message>
						)}
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
				onCreate={(payload) => void onCreateSubmission(payload)}
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
				files={[...items.value, ...libraryPicks.value]}
				checklist={checklist.value}
				onToggle={toggleTask}
				onClose={() => (preSubmitOpen.value = false)}
				onConfirm={() => void onConfirmSubmit()}
				onAddFromLibrary={addLibraryPicks}
			/>
		</div>
	);
}
