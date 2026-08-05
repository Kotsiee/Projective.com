import { computed, signal } from "@preact/signals";
import type {
	AssetCrumb,
	AssetFolder,
	AssetItem,
	AssetPageLike,
	AssetSource,
	AssetTreeNode,
	FileKind,
	FileScope,
	FileSortDir,
	FileSortKey,
	PickerRequest,
	StorageQuota,
	UploadTask,
} from "../types/file-types.ts";

/**
 * files-state — the cross-island signal bridge for the `/files` asset hub, where the surface is
 * composed from four independently-hydrated regions that must agree on one query:
 *
 *  - the **lane** (the folder / drive tree + the scope switch),
 *  - the **header band** (identity, breadcrumbs, search, the sort + kind/source refinements),
 *  - the **body** (the asset grid ⁄ table — the only region that owns data and fetches),
 *  - the **footer rig** (zoom, upload, the selection action bar).
 *
 * Each is a separate hydration root resolved by its own SSR slot, so they cannot share props. They
 * share this module instead — the pattern the board footer↔body (`board-state.ts`) and the inbox's
 * four regions (`inbox-state.ts`) already use. **The body is the single fetch owner**: every other
 * region writes intent here and the body reacts, so there is exactly one request path and no region
 * can desynchronise from the data it is describing.
 *
 * **These signals are module-level and therefore per-PROCESS on the server.** Nothing in the SSR path
 * may write to them — a server-side write would leak one request's library into the next person's
 * first paint. SSR resolves through `files-ssr.ts` and passes its result as PROPS; the body seeds
 * these signals on mount, in the browser, where the module instance belongs to one tab.
 */

// #region Location (written by the lane + the router, read by everyone)
/** The path-segment chain addressing the folder in view; `[]` is the scope root. */
export const currentPath = signal<string[]>([]);

/** The space being read. */
export const currentScope = signal<FileScope>("hub");

/** The scope's subject — an owner id (`hub`), a project id, a conversation id, a connection id, a slug. */
export const subjectId = signal<string | null>(null);

/** The channel being read, when the scope is `channel`. */
export const channelId = signal<string | null>(null);

/** The folder id the server resolved {@link currentPath} to; `null` at the scope root. */
export const folderId = signal<string | null>(null);

/**
 * Whether this whole LOCATION is read-only for the viewer.
 *
 * A location-level fact, distinct from the per-asset `canManage`: a mounted project channel and a
 * connected drive are read-only in the hub as PLACES, so the surface withholds the upload target and
 * the new-folder control rather than offering them and refusing every attempt.
 */
export const readOnly = signal(false);

/** The acting viewer's id, as the server reported it — never read from a cookie client-side. */
export const viewerId = signal("");
// #endregion

// #region Data (written by the body, read by the lane + the header)
/** The assets in view, already sorted + filtered by the server. */
export const items = signal<AssetItem[]>([]);

/** The folders beside them, in the same folder. */
export const folders = signal<AssetFolder[]>([]);

/** The navigation tree for the scope — the lane renders it, the header derives breadcrumbs from it. */
export const tree = signal<AssetTreeNode[]>([]);

/** The server-built breadcrumb trail to {@link currentPath}. */
export const crumbs = signal<AssetCrumb[]>([]);

/** The owning principal's storage allowance, or `null` for a scope that consumes none. */
export const quota = signal<StorageQuota | null>(null);

/**
 * Whether the body has seeded {@link items} yet.
 *
 * Explicit, because the obvious shorthand is WRONG: `items.value.length === 0` conflates "not loaded"
 * with "loaded, and the answer is none". A search matching nothing is the second, and every region
 * that guessed from emptiness fell back to its SSR value — the header printed the full count above an
 * empty grid and the body re-seeded its SSR rows over a zero-result query. That bug has shipped twice
 * in this repository (Decision #63); it is not hypothetical, and this flag is the fix.
 */
export const seeded = signal(false);

/** A read or refine is in flight. */
export const loading = signal(false);

/** The last transport failure, or `null`. Rendered by the body; never swallowed. */
export const error = signal<string | null>(null);

/** More pages exist beyond what is loaded. */
export const hasMore = signal(false);

/** The cursor for the next page; `null` when there is none. */
export const nextCursor = signal<string | null>(null);

/** Total matched across all pages — the "N files" caption, which may exceed what is loaded. */
export const total = signal(0);
// #endregion

// #region Query intent (written by the header + the lane, read by the body)
/** Free-text filename match. */
export const query = signal("");

/** The property the grid ⁄ table is ordered on. */
export const sortKey = signal<FileSortKey>("date");

/** Sort direction. */
export const sortDir = signal<FileSortDir>("desc");

/** Restrict to these kinds; empty = every kind. */
export const kindFilter = signal<FileKind[]>([]);

/** Restrict to these storage sources; empty = every source. */
export const sourceFilter = signal<AssetSource[]>([]);

/** Whether anything is currently narrowing the set — drives the empty state's copy and its reset. */
export const narrowed = computed(() =>
	query.value.trim().length > 0 || kindFilter.value.length > 0 || sourceFilter.value.length > 0
);
// #endregion

// #region Selection
/**
 * Selected asset ids, in CLICK order.
 *
 * Order is preserved rather than normalised to display order because a bulk action reports on what
 * was chosen ("Move 3 files"), and a person who picked the last row first expects it named first.
 * {@link rangeSelect} is the one exception — a shift-range is inherently a display-order run.
 */
export const selection = signal<string[]>([]);

/** The anchor a shift-range extends from; `null` when there is no anchor yet. */
export const anchorId = signal<string | null>(null);

/** The asset the Inspect panel is describing; `null` closes the panel. */
export const inspectId = signal<string | null>(null);

/** Whether anything is selected — the footer rig's action-bar gate. */
export const hasSelection = computed(() => selection.value.length > 0);

/** Select exactly one asset and make it the range anchor. */
export function selectOnly(id: string): void {
	selection.value = [id];
	anchorId.value = id;
}

/**
 * Add or remove one asset from the selection (a ctrl/cmd click).
 *
 * Removing the current anchor re-anchors on whatever remains selected rather than clearing it, so a
 * following shift-click still has somewhere to extend from — an anchor that silently became `null`
 * turned the next range into a single-row selection.
 */
export function toggleSelect(id: string): void {
	const current = selection.value;
	if (current.includes(id)) {
		const next = current.filter((x) => x !== id);
		selection.value = next;
		if (anchorId.value === id) anchorId.value = next.length > 0 ? next[next.length - 1] : null;
		return;
	}
	selection.value = [...current, id];
	anchorId.value = id;
}

/**
 * Select the inclusive run between the anchor and `id`, in the order the rows are displayed.
 *
 * `orderedIds` is passed IN rather than derived from {@link items} because the visible order is the
 * body's business — a grid may group folders first, a table may be sorted on a column the server did
 * not sort by, and a range computed against the wrong order selects rows the person can see they did
 * not drag over.
 *
 * With no anchor, or with an anchor that is no longer on screen, this degrades to {@link selectOnly}:
 * extending from a row that is not there would select an arbitrary run.
 */
export function rangeSelect(id: string, orderedIds: readonly string[]): void {
	const anchor = anchorId.value;
	const from = anchor === null ? -1 : orderedIds.indexOf(anchor);
	const to = orderedIds.indexOf(id);
	if (from < 0 || to < 0) {
		selectOnly(id);
		return;
	}
	const [lo, hi] = from <= to ? [from, to] : [to, from];
	selection.value = orderedIds.slice(lo, hi + 1);
	// The anchor deliberately survives, so a second shift-click re-extends from the same origin
	// instead of walking it along behind the pointer.
}

/** Clear the selection and its anchor. The Inspect panel is left alone — it is a separate question. */
export function clearSelection(): void {
	selection.value = [];
	anchorId.value = null;
}
// #endregion

// #region Upload queue
/** The in-flight and finished uploads, oldest first. Browser-only; never seeded by SSR. */
export const uploadQueue = signal<UploadTask[]>([]);

/** Uploads still doing work — the footer's progress affordance and the beforeunload guard. */
export const uploadsActive = computed(() =>
	uploadQueue.value.filter((t) =>
		t.phase !== "done" && t.phase !== "error" && t.phase !== "cancelled" && t.phase !== "blocked"
	)
);

/** Append tasks to the queue (a drop of N files enqueues N tasks in one write). */
export function enqueueUploads(tasks: readonly UploadTask[]): void {
	if (tasks.length === 0) return;
	uploadQueue.value = [...uploadQueue.value, ...tasks];
}

/**
 * Patch one queued task by id.
 *
 * A patch rather than a replace because the phases advance from different places — the hasher writes
 * `progress`, the dedup check writes `verdict`, the person writes `resolution` — and a replace would
 * make each of those callers responsible for carrying the other two's fields forward.
 */
export function patchUpload(id: string, patch: Partial<UploadTask>): void {
	uploadQueue.value = uploadQueue.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/** Drop one task from the queue entirely (an explicit dismiss). */
export function dequeueUpload(id: string): void {
	uploadQueue.value = uploadQueue.value.filter((t) => t.id !== id);
}

/** Drop every settled task, keeping anything still working. */
export function clearFinishedUploads(): void {
	uploadQueue.value = uploadQueue.value.filter((t) =>
		t.phase !== "done" && t.phase !== "cancelled"
	);
}
// #endregion

// #region Asset picker
/** Whether the Asset Picker is open. */
export const pickerOpen = signal(false);

/** What the open picker was opened for; `null` when it is closed. */
export const pickerRequest = signal<PickerRequest | null>(null);

/** The assets the picker currently has chosen — published so the requester can read the answer. */
export const pickerSelection = signal<AssetItem[]>([]);

/** Open the picker for a request, starting from an empty selection. */
export function openPicker(request: PickerRequest): void {
	pickerRequest.value = request;
	pickerSelection.value = [];
	pickerOpen.value = true;
}

/**
 * Close the picker.
 *
 * The request and the selection are deliberately NOT cleared here: the requester reads them after the
 * close, and clearing on close would race the handler that is about to consume the answer. The next
 * {@link openPicker} resets both, which is the moment at which stale values actually stop being
 * anyone's business.
 */
export function closePicker(): void {
	pickerOpen.value = false;
}
// #endregion

// #region Read lifecycle (the body's write path)
/** Mark a read as started: spinner on, previous error cleared. */
export function beginLoad(): void {
	loading.value = true;
	error.value = null;
}

/**
 * Adopt a server page as the CURRENT contents.
 *
 * Every optional field is applied only when the page carries it, so a partial payload never blanks a
 * region the server simply did not re-send. The selection is pruned to ids that survived, because a
 * bulk action over ids that are no longer listed is a request to mutate things the person can no
 * longer see.
 */
export function applyPage(page: AssetPageLike): void {
	items.value = page.items;
	if (page.folders) folders.value = page.folders;
	if (page.tree) tree.value = page.tree;
	if (page.crumbs) crumbs.value = page.crumbs;
	if (page.quota !== undefined) quota.value = page.quota;
	if (page.hasMore !== undefined) hasMore.value = page.hasMore;
	if (page.nextCursor !== undefined) nextCursor.value = page.nextCursor;
	if (page.total !== undefined) total.value = page.total;
	if (page.scope) currentScope.value = page.scope;
	if (page.subjectId !== undefined) subjectId.value = page.subjectId;
	if (page.folderId !== undefined) folderId.value = page.folderId;
	if (page.readOnly !== undefined) readOnly.value = page.readOnly;
	if (page.viewerId) viewerId.value = page.viewerId;
	// `currentPath` is deliberately NOT written from the page: the path is the ROUTER's state (the
	// lane and the address bar own it), and echoing the server's resolution back over it would undo a
	// navigation the person started while the previous read was still in flight.
	pruneSelection();
	seeded.value = true;
	loading.value = false;
	error.value = null;
}

/**
 * Append the next page to what is already loaded (infinite scroll).
 *
 * Separate from {@link applyPage} rather than a flag on it: the two differ in what they do to the
 * tree, the breadcrumbs and the scroll position, and a boolean argument at the call site is exactly
 * the kind of thing that gets passed wrong once and silently truncates a library.
 *
 * Ids already present are skipped, so a cursor replayed after a retry cannot duplicate rows.
 */
export function appendPage(page: AssetPageLike): void {
	const known = new Set(items.value.map((i) => i.id));
	items.value = [...items.value, ...page.items.filter((i) => !known.has(i.id))];
	if (page.hasMore !== undefined) hasMore.value = page.hasMore;
	if (page.nextCursor !== undefined) nextCursor.value = page.nextCursor;
	if (page.total !== undefined) total.value = page.total;
	seeded.value = true;
	loading.value = false;
	error.value = null;
}

/**
 * Record a failed read.
 *
 * {@link seeded} is deliberately left untouched: a failure is not a successful load of nothing, and
 * flipping the flag here would let an error state render as an empty library. Consumers branch on
 * `error` first, then `seeded`, then emptiness.
 */
export function applyError(message: string): void {
	error.value = message;
	loading.value = false;
}

/** Drop selected ids that are no longer listed, and re-point the anchor if it went with them. */
function pruneSelection(): void {
	if (selection.value.length === 0 && anchorId.value === null) return;
	const live = new Set(items.value.map((i) => i.id));
	const next = selection.value.filter((id) => live.has(id));
	if (next.length !== selection.value.length) selection.value = next;
	if (anchorId.value !== null && !live.has(anchorId.value)) {
		anchorId.value = next.length > 0 ? next[next.length - 1] : null;
	}
	if (inspectId.value !== null && !live.has(inspectId.value)) inspectId.value = null;
}
// #endregion

// #region Reset
/**
 * Return every signal to its initial value.
 *
 * The body calls this on unmount so a later navigation into a different scope starts clean — without
 * it, a module-level signal outlives the island that filled it and the next library paints with the
 * previous one's tree for a frame.
 */
export function resetFilesState(): void {
	currentPath.value = [];
	currentScope.value = "hub";
	subjectId.value = null;
	channelId.value = null;
	folderId.value = null;
	readOnly.value = false;
	viewerId.value = "";
	items.value = [];
	folders.value = [];
	tree.value = [];
	crumbs.value = [];
	quota.value = null;
	seeded.value = false;
	loading.value = false;
	error.value = null;
	hasMore.value = false;
	nextCursor.value = null;
	total.value = 0;
	query.value = "";
	sortKey.value = "date";
	sortDir.value = "desc";
	kindFilter.value = [];
	sourceFilter.value = [];
	selection.value = [];
	anchorId.value = null;
	inspectId.value = null;
	uploadQueue.value = [];
	pickerOpen.value = false;
	pickerRequest.value = null;
	pickerSelection.value = [];
}
// #endregion

// #region Commit seam (any region asks the body to refetch)
/** The body registers its fetch here on mount; every other region calls {@link commitFiles}. */
export const filesCommit = signal<(() => void) | null>(null);

/** Ask the body to re-run its query. A no-op before the body hydrates (the SSR paint is correct). */
export function commitFiles(): void {
	filesCommit.value?.();
}

/** Reset every narrowing control back to the whole folder, then refetch. */
export function clearFilesFilters(): void {
	query.value = "";
	kindFilter.value = [];
	sourceFilter.value = [];
	commitFiles();
}
// #endregion
