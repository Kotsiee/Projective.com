import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// #region Stylesheet carriers
/**
 * A stylesheet reaches a page ONLY through a client/island bundle — a sheet imported by a server
 * component ships nothing. Every shared component this island can mount has its sheet imported HERE,
 * at the hydration root, rather than relying on the component's own import being collected from a
 * graph it is not in. The list is deliberately wider than the default render path: the picker has
 * conditional branches (the link form, the upload queue, the Inspect pane), and a branch that only
 * appears on a failure or an empty result is exactly the one that would otherwise ship unstyled.
 */
import "@web/features/projects/styles/file-card.css";
import "@web/features/projects/styles/file-table.css";
import "@web/features/projects/styles/submission-card.css";
import "@web/features/projects/styles/attachment-modal.css";
import "../styles/files-hub.css";
import "../styles/asset-picker.css";
// #endregion

import { Backdrop, BodyPortal } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Button, InputText } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	useDraggable,
	useDroppable,
} from "@projective/ui/dnd";

import { FileKindIcon } from "@web/features/projects/components/file-glyphs.tsx";

import { FilesService } from "../core/FilesService.ts";
import { IntegrationsService } from "../core/IntegrationsService.ts";
import { simFromSeam, subscribeFilesSim } from "../core/files-seam.ts";
import { breadcrumbsFor, pathKey } from "../core/asset-model.ts";
import { fingerprintFile } from "../core/fingerprint.ts";
import { awaitExtraction, extractMetadata } from "../core/media/extract.ts";
import {
	anchorId,
	clearFinishedUploads,
	clearSelection,
	closePicker,
	enqueueUploads,
	patchUpload,
	pickerOpen,
	pickerRequest,
	pickerSelection,
	rangeSelect,
	selection,
	selectOnly,
	toggleSelect,
	uploadQueue,
} from "../core/files-state.ts";
import {
	type AssetFolder,
	type AssetItem,
	type AssetListParams,
	type AssetSource,
	type AssetTreeNode,
	CATEGORY_META,
	categoryToKind,
	type FileCategory,
	FileKind,
	type FileScope,
	type FilesSim,
	formatMib,
	MIB,
	type StorageQuota,
	type UploadTask,
} from "../types/file-types.ts";
import { AssetBreadcrumbs } from "../components/AssetBreadcrumbs.tsx";
import { type AssetActivation, AssetCard } from "../components/AssetCard.tsx";
import { AssetFolderCard } from "../components/AssetFolderCard.tsx";
import { AssetTree, ROOT_KEY } from "../components/AssetTree.tsx";
import { InspectPanel } from "../components/InspectPanel.tsx";
import { QuotaMeter } from "../components/QuotaMeter.tsx";
import { SourceMark } from "../components/file-hub-glyphs.tsx";

/**
 * AssetPicker — the one modal every surface on the platform uses to attach something the person
 * ALREADY has, instead of asking them to find it on disk and upload a second copy.
 *
 * It is the `/files` hub adapted to a modal container, and adapted rather than re-drawn on purpose:
 * the file tile is the same {@link AssetCard}, the folder tile the same {@link AssetFolderCard}, the
 * directory tree the same {@link AssetTree}, the detail pane the same {@link InspectPanel} and the
 * allowance the same {@link QuotaMeter}. A person who has learned to find a file in one place has
 * learned to find it in the other, and a second card family is how those two places start to drift.
 *
 * ## How a host uses it
 *
 * Two halves, and both are required. The host mounts this island **unconditionally** and calls
 * `openPicker(request)` from whatever control opens it:
 *
 * ```tsx
 * const PICKER = "chat-composer";
 * openPicker({ requesterId: PICKER, kinds: ["image"], multiple: true, max: 10 });
 * …
 * <AssetPicker requesterId={PICKER} onPick={(assets) => stage(assets)} />
 * ```
 *
 * **Unconditionally is not a style note.** A conditionally-rendered island is absent from the page's
 * island graph until the condition flips, and that graph is what carries component CSS — so a picker
 * mounted only while open would paint its first frame unstyled. It therefore always renders a real
 * root node and hides itself internally.
 *
 * Everything a host can express through the global request it can also express through PROPS
 * ({@link AssetPickerProps.open} · `mode` · `accept` · `scope` · `onClose`), which is what lets a
 * surface that already owns its own open-state drive the picker directly. Props WIN where both are
 * supplied; the global request remains the default so the five existing hosts keep working unchanged.
 *
 * ## Why the requester id exists
 *
 * The open request and its answer are published GLOBALLY (`files-state`'s picker region), so one host
 * can open a picker that another host's control mounted. `requesterId` is how each instance knows
 * whether the currently-open request is its own; without it, a page with two pickers hands the second
 * one the first one's files. An instance whose id does not match the open request renders closed and
 * touches nothing.
 *
 * ## The shell is hand-rolled, and `Dialog` is deliberately not used
 *
 * `Dialog` is a bounded, single-column reading surface: `overflow: hidden`, a `--overlay-w-*` cap and
 * a padded body. A two-pane workspace with a resizable tree, a scrolling grid and a detail pane fights
 * all three, which is why both shipped splitter modals (the submission review, the ticket view) bypass
 * it too. This composes the same primitives `Dialog` does — {@link BodyPortal} + {@link Backdrop} +
 * `useOverlayStack` + `useFocusTrap` + `useDismiss` — at the size this surface actually needs.
 *
 * `layer: "modal"` is passed EXPLICITLY. `useOverlayStack` defaults to the `popover` band (1100), and
 * a modal that takes the default is outranked by any popover opened after it.
 *
 * ## What it deliberately does NOT share with the hub
 *
 * The hub body is `files-state`'s single fetch owner. The picker is a second surface that can be open
 * OVER `/files`, so it keeps its own listing in LOCAL signals and writes exactly two shared regions —
 * {@link pickerSelection} (the answer) and {@link selection} (the ids, so the shared
 * `selectOnly`/`toggleSelect`/`rangeSelect` mutators are the ONE implementation of modifier
 * selection). Writing `items`/`folders`/`crumbs` would replace the library behind the modal with
 * whatever folder the picker happened to be browsing, and closing the modal would leave it there.
 *
 * Because `selection` IS shared, the host's own selection is snapshotted on open and restored on
 * close: a hub user who had three files selected, opened the picker and cancelled must find their
 * three files still selected.
 *
 * It also does not window-virtualize. `VirtualGrid` and `FileTable` measure the WINDOW, and inside a
 * dialog the scroller is the dialog's own body — the measurement would be of a box the rows do not
 * occupy. A plain `auto-fill` CSS grid over a paged slice is correct here and costs nothing at this
 * size.
 */

// #region Props
/** A space the picker may browse, named by the host that knows its subject. */
export interface PickerScope {
	scope: FileScope;
	/** The scope's subject — a project id, a conversation id, a connection id. */
	subjectId?: string | null;
	/** The channel, when the scope is `channel`. */
	channelId?: string | null;
	/** What to call it in the source rail; defaults to a scope-appropriate label. */
	label?: string;
}

export interface AssetPickerProps {
	/**
	 * The routing key. Must equal the `requesterId` the host passes to `openPicker`, or this instance
	 * stays closed while somebody else's request is open.
	 */
	requesterId: string;
	/**
	 * The chosen assets, when the person confirms. Never fired on cancel, on Escape, or on a backdrop
	 * dismiss — a picker that reports a selection nobody accepted is how a file gets attached by
	 * someone who was only looking.
	 */
	onPick: (assets: AssetItem[]) => void;
	/**
	 * Controlled open state. When supplied it WINS over the global request, so a host that already
	 * owns its own modal state does not have to route through `files-state` to use the picker.
	 */
	open?: boolean;
	/** How many assets may come back. Defaults to the open request's `multiple`. */
	mode?: "single" | "multi";
	/**
	 * Restrict what may be chosen. Accepts coarse {@link FileKind}s (`"image"`) or rich
	 * {@link FileCategory}s (`"Vector"`) — mixed freely, since the two vocabularies are disjoint.
	 * Defaults to the open request's `kinds`.
	 */
	accept?: FileKind[] | FileCategory[];
	/** The engagement space to offer beside the personal library ("This project"). */
	scope?: PickerScope;
	/** Dismiss. Defaults to `closePicker()`. */
	onClose?: () => void;
}
// #endregion

// #region Sources
/**
 * Where the picker can look. One list, in reading order — and the order is the answer to "where would
 * I have put this?": the engagement I am in, then my own library, then what I touched last, then the
 * accounts I have linked, then the two ways of introducing something that is not here yet.
 */
type SourceKey = "project" | "library" | "recent" | "drives" | "link" | "upload";

interface SourceSpec {
	key: SourceKey;
	label: string;
	icon: IconName;
	/** The one-line caption shown under the workspace bar while this source is active. */
	note: string;
}

const SOURCES: readonly SourceSpec[] = [
	{
		key: "project",
		label: "This project",
		icon: "projects",
		note: "Everything attached inside this engagement.",
	},
	{
		key: "library",
		label: "My files",
		icon: "folder",
		note: "Your own library — browse it like a folder tree.",
	},
	{
		key: "recent",
		label: "Recent",
		icon: "clock",
		note: "The newest additions to your library, newest first.",
	},
	{
		key: "drives",
		label: "Connected drives",
		icon: "box",
		note: "Read-only. Files stay where they live; attaching links to them.",
	},
	{ key: "link", label: "Paste a link", icon: "link", note: "Store a web address as a file." },
	{ key: "upload", label: "Upload", icon: "upload", note: "Add something from this device." },
];

/** The three sources that BROWSE a listing; the other two produce one asset and hand it straight over. */
const BROWSING: ReadonlySet<SourceKey> = new Set<SourceKey>([
	"project",
	"library",
	"recent",
	"drives",
]);
// #endregion

// #region Accept model
/** The coarse kinds, as a runtime set — the discriminator between a kind and a category. */
const KIND_VALUES: ReadonlySet<string> = new Set<string>(FileKind.options);

/** Plural nouns for the empty state. "No images here" beats "No files here". */
const KIND_NOUN: Readonly<Record<FileKind, string>> = {
	image: "images",
	video: "videos",
	audio: "audio files",
	pdf: "PDFs",
	doc: "documents",
	code: "code files",
	archive: "archives",
	link: "links",
	file: "files",
};

/** The `accept` attribute fragment a kind maps onto; `null` = no honest restriction exists. */
const KIND_ACCEPT: Readonly<Record<FileKind, string | null>> = {
	image: "image/*",
	video: "video/*",
	audio: "audio/*",
	pdf: "application/pdf,.pdf",
	doc: null,
	code: null,
	archive: null,
	link: null,
	file: null,
};

/** A resolved restriction: what the server narrows, what the client narrows, and what to call it. */
interface AcceptFilter {
	/** Sent to the server as `kinds`. Empty = every kind. */
	kinds: FileKind[];
	/** Applied client-side on the exact category. Empty = every category. */
	categories: FileCategory[];
	/** A plural noun for the empty state, or `null` when nothing is restricted. */
	noun: string | null;
	/** The file input's `accept`; empty = unrestricted. */
	attr: string;
	/** Whether anything is restricted at all. */
	active: boolean;
}

const NO_ACCEPT: AcceptFilter = {
	kinds: [],
	categories: [],
	noun: null,
	attr: "",
	active: false,
};

/**
 * Resolve the host's `accept` into the two narrowings it implies.
 *
 * A CATEGORY implies its kind, so a category restriction still narrows on the server (which knows
 * only kinds) before the client narrows further — the alternative fetches a page of documents to hide
 * all but the spreadsheets, and then reports a page count that does not match what is drawn.
 */
function resolveAccept(list: readonly string[] | undefined | null): AcceptFilter {
	if (!list || list.length === 0) return NO_ACCEPT;
	const kinds = new Set<FileKind>();
	const categories: FileCategory[] = [];
	for (const entry of list) {
		if (KIND_VALUES.has(entry)) {
			kinds.add(entry as FileKind);
		} else if (Object.hasOwn(CATEGORY_META, entry)) {
			const category = entry as FileCategory;
			categories.push(category);
			kinds.add(categoryToKind(category));
		}
	}
	if (kinds.size === 0) return NO_ACCEPT;

	const kindList = [...kinds];
	const noun = categories.length === 1
		? `${CATEGORY_META[categories[0]].label.toLowerCase()} files`
		: kindList.length === 1
		? KIND_NOUN[kindList[0]]
		: "files of that type";

	// An `accept` attribute that cannot express one of the kinds must not express ANY of them: a
	// partial pattern silently greys out valid files in the OS picker, which reads as a broken dialog.
	const fragments = kindList.map((k) => KIND_ACCEPT[k]);
	const attr = fragments.every((f) => f !== null) ? fragments.join(",") : "";

	return { kinds: kindList, categories, noun, attr, active: true };
}

/** Whether one asset satisfies the restriction. */
function accepts(filter: AcceptFilter, asset: AssetItem): boolean {
	if (filter.kinds.length > 0 && !filter.kinds.includes(asset.kind)) return false;
	if (filter.categories.length > 0 && !filter.categories.includes(asset.category)) return false;
	return true;
}
// #endregion

// #region Drop-target ids
/** The grid's folder cells and the tree's rows are two id spaces, so one folder can be both at once. */
function gridDropId(folderId: string): string {
	return `apk-grid:${folderId}`;
}
function treeDropId(key: string): string {
	return `apk-tree:${key}`;
}

/** One addressable row of the tree, in the order {@link AssetTree} actually paints it. */
interface TreeRow {
	key: string;
	folderId: string | null;
	readOnly: boolean;
	/** Whether a drop here has a real destination. A synthetic grouping node has none. */
	droppable: boolean;
}

/**
 * The tree rows that are currently VISIBLE, in paint order.
 *
 * `TreeNav` exposes no per-row hook and renders a branch's children only while it is expanded, so a
 * drop target has to be addressed positionally. That is safe here and only here, because this island
 * owns both sides of the correspondence: it supplies the node list AND the expansion set, so the walk
 * below reproduces the component's own recursion exactly rather than guessing at it.
 */
function visibleTreeRows(
	tree: readonly AssetTreeNode[],
	expanded: ReadonlySet<string>,
): TreeRow[] {
	const rows: TreeRow[] = [
		{ key: ROOT_KEY, folderId: null, readOnly: false, droppable: true },
	];
	if (!expanded.has(ROOT_KEY)) return rows;

	const walk = (nodes: readonly AssetTreeNode[], parent: string[]): void => {
		for (const node of nodes) {
			const path = [...parent, node.segment];
			const key = pathKey(path);
			const folderId = node.folderId ?? null;
			rows.push({
				key,
				folderId,
				readOnly: node.readOnly === true,
				// A node with no folder is a grouping row; "move into a grouping" has no meaning, and
				// offering it would move the files to the library root under a different name.
				droppable: folderId !== null && node.readOnly !== true,
			});
			if (node.children.length > 0 && expanded.has(key)) walk(node.children, path);
		}
	};
	walk(tree, []);
	return rows;
}
// #endregion

// #region Constants
/** How long a keystroke waits before it becomes a request. */
const SEARCH_DEBOUNCE_MS = 250;

/** One page of the picker's grid. Small — the picker is a finder, not a library viewer. */
const PAGE_LIMIT = 60;

/** A client-minted upload key. `randomUUID` needs a secure context, so there is a plain fallback. */
function queueKey(): string {
	try {
		return globalThis.crypto?.randomUUID?.() ?? `apk-${Date.now()}-${Math.random().toString(36)}`;
	} catch {
		return `apk-${Date.now()}-${Math.random().toString(36)}`;
	}
}
// #endregion

// #region Cells
interface AssetCellProps {
	asset: AssetItem;
	selected: boolean;
	/** Greyed because the cap is reached, or because `accept` refuses it. */
	blockedReason: string | null;
	onSelect: (asset: AssetItem, activation: AssetActivation) => void;
	/** A press on a blocked card. It SAYS why rather than doing nothing — silence explains nothing. */
	onBlocked: (reason: string) => void;
	onInspect: (asset: AssetItem) => void;
	onOpenRaw: (asset: AssetItem) => void;
	/** How many assets a drag from this cell would carry — the grip's announced payload. */
	dragCount: number;
	/** Whether this LOCATION accepts a move at all (a mount does not). */
	movable: boolean;
}

/**
 * PickerAssetCell — an {@link AssetCard} plus its drag GRIP and its chosen mark.
 *
 * The grip exists rather than making the whole card draggable, and the reason is accessibility, not
 * taste: `useDraggable`'s attributes put `role="button"` and a `tabIndex` on their host and its
 * `onKeyDown` claims Enter/Space. Spreading that over a card that already IS a `<button>` would nest
 * two interactive roles and steal the card's own keyboard activation — which here is the SELECT, the
 * one thing a picker exists for. A dedicated handle keeps Enter/Space on the card and gives keyboard
 * drag its own affordance (Space to pick up, Arrows to move, Enter to drop).
 */
function PickerAssetCell(props: AssetCellProps): JSX.Element {
	const { asset, selected, blockedReason, onSelect, onBlocked, onInspect, onOpenRaw } = props;
	const { dragCount, movable } = props;
	const draggable = movable && asset.canManage && blockedReason === null;
	const drag = useDraggable({
		id: asset.id,
		data: { type: "asset" },
		disabled: !draggable,
		roleDescription: "file",
	});

	const moveLabel = dragCount > 1 ? `Move ${dragCount} selected files` : `Move ${asset.name}`;

	return (
		<div
			class="apk-cell apk-cell--asset"
			ref={drag.setNodeRef}
			data-selected={selected ? "true" : undefined}
			data-blocked={blockedReason !== null ? "true" : undefined}
			data-dragging={drag.isDragging.value ? "true" : undefined}
		>
			<AssetCard
				asset={asset}
				selected={selected}
				onSelect={(a, activation) => {
					if (blockedReason !== null) {
						onBlocked(blockedReason);
						return;
					}
					onSelect(a, activation);
				}}
				// Double click opens the detail pane rather than a preview modal: a second overlay over
				// a picker is a layer the reader then has to find their way back out of, and everything
				// the preview would have told them is in the pane beside the grid.
				onPreview={onInspect}
				onOpenRaw={onOpenRaw}
			/>

			{selected
				? (
					<span class="apk-cell__tick" aria-hidden="true">
						<Icon name="check" size="2xs" />
					</span>
				)
				: null}

			{
				/*
				 * A blocked card's reason is announced on the CARD, not on an extra badge: a badge would
				 * need its own focus stop to carry a tooltip, and one extra tab stop per unpickable cell
				 * turns a full grid into a keyboard maze. The card keeps its own name and gains the reason.
				 */
			}
			{blockedReason !== null ? <span class="ui-visually-hidden">{blockedReason}</span> : null}

			{draggable
				? (
					<Tooltip content={moveLabel}>
						<span
							class="fh-cell__grip apk-cell__grip"
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
 * PickerFolderCell — an {@link AssetFolderCard} registered as a drop target.
 *
 * A mounted folder is NOT a target: a connected drive is shown so a person can find what they already
 * have, not so it becomes a second write path into someone else's system of record. Disabling the
 * droppable rather than filtering it out keeps the card in the grid — the folder is still browsable,
 * it simply refuses a drop.
 */
function PickerFolderCell({ folder, onOpen }: FolderCellProps): JSX.Element {
	const writable = folder.source === "supabase" && folder.canManage;
	const drop = useDroppable({
		id: gridDropId(folder.id),
		data: { accepts: ["asset"] },
		disabled: !writable,
	});

	return (
		<div class="apk-cell apk-cell--folder" ref={drop.setNodeRef}>
			<AssetFolderCard folder={folder} onOpen={onOpen} dropOver={drop.isOver.value} />
		</div>
	);
}

interface TreeDropProps {
	row: TreeRow;
	index: number;
	containerRef: { current: HTMLDivElement | null };
}

/**
 * TreeDropTarget — one droppable bound to one painted tree row. Renders nothing.
 *
 * It exists because `AssetTree` (and the shared `TreeNav` beneath it) is reused VERBATIM, which is the
 * whole point of the component, and a verbatim tree cannot grow a per-row `ref`. So the target is
 * bound to the row element positionally and its rect is read lazily at hit-test time, which keeps the
 * real collision engine — and therefore keyboard drag, `isOver`, and the cancel path — working exactly
 * as they do in the grid.
 *
 * The hover treatment is a `data-dropover` attribute written onto the row rather than a prop, for the
 * same reason: the row belongs to another component. It is a drag affordance and nothing depends on
 * it, and `clearDropMarks` sweeps the container at the end of every drag so a mark can never survive
 * the gesture that produced it.
 */
function TreeDropTarget({ row, index, containerRef }: TreeDropProps): null {
	const drop = useDroppable({
		id: treeDropId(row.key),
		data: { accepts: ["asset"] },
		disabled: !row.droppable,
	});

	// Re-bound on every render: expanding a branch re-renders the rows, and a target still pointing at
	// a detached element would hit-test against a rect that is no longer on screen.
	useEffect(() => {
		const rows = containerRef.current?.querySelectorAll<HTMLElement>(".ui-treenav__row");
		drop.setNodeRef(rows?.[index] ?? null);
	});

	useSignalEffect(() => {
		const over = drop.isOver.value;
		const el = drop.nodeRef.current;
		if (!el) return;
		if (over) el.setAttribute("data-dropover", "true");
		else el.removeAttribute("data-dropover");
	});

	return null;
}
// #endregion

export default function AssetPicker(props: AssetPickerProps): JSX.Element {
	const { requesterId, onPick } = props;

	// #region Open/close resolution
	const request = pickerRequest.value?.requesterId === requesterId ? pickerRequest.value : null;
	const globallyOpen = pickerOpen.value && request !== null;
	const isOpen = props.open ?? globallyOpen;

	const mode: "single" | "multi" = props.mode ?? (request?.multiple ? "multi" : "single");
	const multiple = mode === "multi";
	const cap = multiple ? (request?.max ?? null) : 1;
	const title = request?.title ?? "Attach from your files";
	const accept = resolveAccept(props.accept ?? request?.kinds);
	const scope = props.scope ?? null;
	// #endregion

	// #region Local listing state (never `files-state` — see the module note)
	const source = useSignal<SourceKey>("library");
	/** The folder-NAME chain inside the active source; `[]` is its root. */
	const path = useSignal<string[]>([]);
	/**
	 * The folders drilled through, parallel to {@link path}.
	 *
	 * A drive addresses a location by `folderId` (a provider object id) while the hub addresses it by
	 * a path of names, and the picker navigates both with one gesture. Keeping the chain means the
	 * trail, the "up one level" click and the drive's `folderId` all come from one place instead of
	 * two navigation models that have to be kept in agreement.
	 */
	const chain = useSignal<AssetFolder[]>([]);
	const items = useSignal<AssetItem[]>([]);
	const folders = useSignal<AssetFolder[]>([]);
	const tree = useSignal<AssetTreeNode[]>([]);
	const expanded = useSignal<Set<string>>(new Set([ROOT_KEY]));
	const quota = useSignal<StorageQuota | null>(null);
	const search = useSignal("");
	const driveId = useSignal<string | null>(null);
	const drives = useSignal<{ id: string; label: string; source: AssetSource }[]>([]);

	/**
	 * Whether a read has ANSWERED yet.
	 *
	 * Explicit, because `items.value.length === 0` conflates "not loaded" with "loaded, and there is
	 * nothing" — a search that matches nothing is the second, and every surface in this repository that
	 * guessed from emptiness eventually rendered a stale list over a zero-result query.
	 */
	const seeded = useSignal(false);
	const loading = useSignal(false);
	const error = useSignal<string | null>(null);
	const hasMore = useSignal(false);
	const cursor = useSignal<string | null>(null);
	/** The location itself refuses writes (a mount, a drive) — distinct from a per-asset `canManage`. */
	const locationReadOnly = useSignal(false);

	/** A soft, non-blocking outcome: a refused pick, a failed move, a rejected link. Never swallowed. */
	const notice = useSignal<string | null>(null);
	/** A mutation (move, link, upload finalise) is in flight. */
	const busy = useSignal(false);
	const navOpen = useSignal(true);
	const inspectId = useSignal<string | null>(null);

	/** The link form's field. */
	const linkUrl = useSignal("");
	/** Upload task ids this picker minted — the queue is shared, the rows on screen are not. */
	const myUploads = useSignal<string[]>([]);

	const reqId = useRef(0);
	const simRef = useRef<FilesSim | undefined>(undefined);
	const debounceRef = useRef<number | null>(null);
	const viewerRef = useRef<string>("");
	const restoreRef = useRef<{ ids: string[]; anchor: string | null } | null>(null);
	/** The space whose tree is currently loaded — see {@link loadTree}. `""` forces a refetch. */
	const treeKeyRef = useRef<string>("");

	const panelRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const treeRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// #endregion

	// #region Overlay plumbing
	// `layer: "modal"` EXPLICITLY — the hook defaults to the popover band, and a modal on 1100 is
	// outranked by the next popover that opens over it.
	const stack = useOverlayStack({ active: isOpen, lockScroll: true, layer: "modal" });
	useFocusTrap({ active: isOpen, containerRef: panelRef });

	function dismiss(): void {
		(props.onClose ?? closePicker)();
	}

	useDismiss({
		open: isOpen,
		onDismiss: dismiss,
		panelRef,
		enabled: stack.isTop,
		// A stray click on the backdrop must not throw away six deliberate choices. With nothing chosen
		// there is nothing to lose, so the quick dismissal survives for the common "opened it by
		// mistake" case; with a selection, Escape and Cancel are the two explicit ways out.
		closeOnOutside: pickerSelection.value.length === 0,
	});
	// #endregion

	// #region Location
	const activeSources = useComputed<SourceSpec[]>(() =>
		SOURCES.filter((s) => (s.key === "project" ? scope !== null : true))
	);

	/** The scope a source reads, and how it addresses a folder inside it. */
	function locationOf(key: SourceKey): {
		scope: FileScope;
		subjectId: string | null;
		channelId: string | null;
		/** `true` → the server resolves a path of names; `false` → an explicit `folderId`. */
		byPath: boolean;
		rootLabel: string;
	} {
		switch (key) {
			case "project":
				return {
					scope: scope?.scope ?? "project",
					subjectId: scope?.subjectId ?? null,
					channelId: scope?.channelId ?? null,
					byPath: true,
					rootLabel: scope?.label ?? "This project",
				};
			case "drives":
				return {
					scope: "drive",
					subjectId: driveId.value,
					channelId: null,
					byPath: false,
					rootLabel: drives.value.find((d) => d.id === driveId.value)?.label ?? "Connected drive",
				};
			default:
				return {
					scope: "hub",
					subjectId: null,
					channelId: null,
					byPath: true,
					rootLabel: "My files",
				};
		}
	}

	/** ONE params builder for the first page and every subsequent one (the `/wallet` ledger's lesson). */
	function listParams(next: string | null): AssetListParams {
		const key = source.value;
		const loc = locationOf(key);
		// Recent is the library's newest, so it deliberately ignores the folder chain: a recency feed
		// scoped to one folder is not a recency feed.
		const recent = key === "recent";
		return {
			scope: loc.scope,
			subjectId: loc.subjectId,
			channelId: loc.channelId,
			path: !recent && loc.byPath && path.value.length > 0 ? path.value : undefined,
			folderId: !recent && !loc.byPath ? chain.value.at(-1)?.id ?? null : undefined,
			// Newest first everywhere. A picker is answering "the thing I was just working on" far more
			// often than "the file whose name starts with B", and `recent` is that instinct made explicit
			// rather than a different order.
			sort: "date",
			dir: "desc",
			// The host's `accept` is applied by the SERVER, so the grid never pays to fetch rows it is
			// about to hide.
			kinds: accept.kinds.length > 0 ? accept.kinds : undefined,
			query: search.value.trim() || undefined,
			cursor: next,
			limit: PAGE_LIMIT,
		};
	}

	/** Read the current location. Every path ends in a rendered result or a rendered failure. */
	async function reload(): Promise<void> {
		if (!BROWSING.has(source.value)) return;
		if (source.value === "drives" && driveId.value === null) {
			// Nothing is selected yet, so there is no location to read. This is an empty STATE, not an
			// empty result — flipping `seeded` here would render "no files" for a question nobody asked.
			items.value = [];
			folders.value = [];
			seeded.value = false;
			return;
		}
		const my = ++reqId.current;
		loading.value = true;
		error.value = null;
		const res = await FilesService.list(listParams(null), simRef.current);
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			items.value = res.data.items;
			folders.value = res.data.folders;
			hasMore.value = res.data.hasMore;
			cursor.value = res.data.nextCursor;
			locationReadOnly.value = res.data.readOnly;
			if (res.data.quota !== null) quota.value = res.data.quota;
			if (res.data.viewerId) viewerRef.current = res.data.viewerId;
			seeded.value = true;
			void loadTree();
		} else {
			// No silent `if (ok)` — a refetch with no else leaves the previous folder's contents on
			// screen under a trail that claims to be somewhere else.
			error.value = res.message ?? "Those files could not be loaded.";
		}
	}

	/** Append the next page. Guarded, so a fast scroll cannot fire twice for one cursor. */
	async function loadMore(): Promise<void> {
		if (loading.value || !hasMore.value || !cursor.value) return;
		const my = reqId.current;
		loading.value = true;
		const res = await FilesService.list(listParams(cursor.value), simRef.current);
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			const known = new Set(items.value.map((i) => i.id));
			items.value = [...items.value, ...res.data.items.filter((i) => !known.has(i.id))];
			hasMore.value = res.data.hasMore;
			cursor.value = res.data.nextCursor;
		} else {
			error.value = res.message ?? "The next page could not be loaded.";
		}
	}

	/**
	 * Read the navigation tree for the active source.
	 *
	 * It needs the owning principal, and the picker learns that from the list page's `viewerId` rather
	 * than from a cookie — so this always follows a successful read, never precedes one.
	 *
	 * It is keyed on the SPACE, not on the folder: a tree spans a whole scope, and refetching the
	 * entire hierarchy on every drill-down would put a second request behind every folder click for a
	 * shape that did not change. The key is retired only by a SUCCESS, so a failed tree retries on the
	 * next read instead of being remembered as done.
	 */
	async function loadTree(): Promise<void> {
		const loc = locationOf(source.value);
		if (!viewerRef.current || loc.scope === "drive") return;
		const key = `${loc.scope}:${loc.subjectId ?? ""}`;
		if (treeKeyRef.current === key) return;
		const res = await FilesService.tree({
			scope: loc.scope,
			subjectId: loc.subjectId,
			ownerType: "user",
			ownerId: viewerRef.current,
		}, simRef.current);
		// A failed tree leaves the previous one standing rather than blanking navigation; the grid is
		// still a complete way around (folder cards drill down, the trail climbs back out).
		if (res.ok && res.data) {
			tree.value = res.data;
			treeKeyRef.current = key;
		}
	}

	/** The caller's connected storage accounts, for the drives source. */
	async function loadDrives(): Promise<void> {
		const res = await IntegrationsService.connections(simRef.current);
		if (res.ok && res.data) {
			drives.value = res.data.connections
				.filter((c) => c.providerCapabilities.includes("storage") && c.status === "active")
				.map((c) => ({
					id: c.id,
					label: c.externalAccountLabel ?? c.providerLabel,
					source: providerSource(c.providerSlug),
				}));
		} else {
			drives.value = [];
			notice.value = res.message ?? "Your connected drives could not be listed.";
		}
	}

	/** Re-read after a control changed the query, coalescing keystrokes into one request. */
	function commit(debounced = false): void {
		if (debounceRef.current !== null) clearTimeout(debounceRef.current);
		if (!debounced) {
			void reload();
			return;
		}
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			void reload();
		}, SEARCH_DEBOUNCE_MS) as unknown as number;
	}
	// #endregion

	// #region Navigation
	function resetLocation(): void {
		path.value = [];
		chain.value = [];
		items.value = [];
		folders.value = [];
		cursor.value = null;
		hasMore.value = false;
		seeded.value = false;
		error.value = null;
		inspectId.value = null;
	}

	function pickSource(key: SourceKey): void {
		if (source.value === key) return;
		source.value = key;
		search.value = "";
		// A different space has a different hierarchy, so the cached tree key stops being an answer.
		treeKeyRef.current = "";
		tree.value = [];
		resetLocation();
		if (key === "drives") {
			void loadDrives();
			if (driveId.value !== null) void reload();
			return;
		}
		if (BROWSING.has(key)) void reload();
	}

	function openFolder(folder: AssetFolder): void {
		path.value = [...path.value, folder.name];
		chain.value = [...chain.value, folder];
		inspectId.value = null;
		void reload();
	}

	/**
	 * Navigate to an arbitrary trail — a breadcrumb hop, or a jump anywhere in the tree.
	 *
	 * The folder chain is truncated to match, and DISCARDED outright when the destination is not a
	 * prefix of where we were: a sideways jump to a same-depth sibling would otherwise leave the chain
	 * holding the previous branch's folders, and a drive read addresses its location by the chain's
	 * last id. Losing the chain costs nothing where it is unused (the hub resolves a path of names)
	 * and is the only correct answer where it is.
	 */
	function navigate(next: string[]): void {
		const continues = next.every((segment, i) => path.value[i] === segment);
		path.value = next;
		chain.value = continues ? chain.value.slice(0, next.length) : [];
		inspectId.value = null;
		void reload();
	}

	/** Middle click — hand the raw asset to a new tab. `noopener` so the opened page cannot reach back. */
	function openRaw(asset: AssetItem): void {
		const target = asset.link?.url ?? asset.external?.externalWebUrl ?? asset.url;
		if (!target || target === "#") return;
		globalThis.open(target, "_blank", "noopener,noreferrer");
	}

	/**
	 * Take a copy — the ledger first, then the bytes.
	 *
	 * `via: "picker"` rather than `"hub"`: the download ledger exists so an owner auditing a leak can
	 * see how a copy left, and recording every route as the hub would make the picker invisible in
	 * exactly the audit it matters for.
	 */
	async function download(asset: AssetItem): Promise<void> {
		const target = asset.link?.url ?? asset.url;
		if (!target || target === "#") return;
		await FilesService.recordDownload({ assetId: asset.id, via: "picker" });
		globalThis.open(target, "_blank", "noopener,noreferrer");
	}
	// #endregion

	// #region Selection
	/**
	 * Reconcile the ANSWER from the shared id list.
	 *
	 * `selection` holds ids in click order; the tray has to hold whole rows, and it has to keep the
	 * ones chosen in a folder the person has since navigated away from. So it is rebuilt from what is
	 * loaded now UNION what was already chosen, ordered by the shared list — never by re-filtering the
	 * current page, which would silently drop every cross-folder choice on the next read.
	 */
	function syncTray(): void {
		const known = new Map<string, AssetItem>();
		for (const a of pickerSelection.value) known.set(a.id, a);
		for (const a of items.value) known.set(a.id, a);
		const next: AssetItem[] = [];
		for (const id of selection.value) {
			const asset = known.get(id);
			if (asset) next.push(asset);
		}
		pickerSelection.value = next;
	}

	/** Roll the shared selection back — used when a mutation would breach the cap. */
	function restoreSelection(ids: string[], anchor: string | null): void {
		selection.value = ids;
		anchorId.value = anchor;
	}

	function onSelect(asset: AssetItem, activation: AssetActivation): void {
		notice.value = null;
		// "multiple: false" is a promise to the host about what it will receive. Enforcing it at the
		// click is what keeps the host from having to defend against a payload it said it could not take.
		if (!multiple) {
			if (selection.value.length === 1 && selection.value[0] === asset.id) {
				clearSelection();
			} else {
				selectOnly(asset.id);
			}
			inspectId.value = asset.id;
			syncTray();
			return;
		}

		const before = [...selection.value];
		const beforeAnchor = anchorId.value;
		if (activation.range) rangeSelect(asset.id, orderedIds());
		else if (activation.toggle) toggleSelect(asset.id);
		else selectOnly(asset.id);

		// At the cap a further pick is REFUSED rather than silently evicting the oldest: a person at the
		// limit needs to be told, not to watch a file they chose disappear.
		if (cap !== null && selection.value.length > cap) {
			restoreSelection(before, beforeAnchor);
			notice.value = `You can choose up to ${cap} ${cap === 1 ? "file" : "files"}.`;
			return;
		}

		// Inspect follows the selection: a ctrl-click that REMOVED this asset must not leave the pane
		// describing something the person just deselected.
		inspectId.value = selection.value.includes(asset.id) ? asset.id : null;
		syncTray();
	}

	/** The ids in the order they are painted — the run a shift-range is measured over. */
	function orderedIds(): string[] {
		return visibleItems.value.map((a) => a.id);
	}

	function removeFromTray(id: string): void {
		selection.value = selection.value.filter((x) => x !== id);
		if (anchorId.value === id) anchorId.value = selection.value.at(-1) ?? null;
		pickerSelection.value = pickerSelection.value.filter((a) => a.id !== id);
		if (inspectId.value === id) inspectId.value = null;
	}

	/** Add an asset the picker just CREATED (an upload, a stored link) straight to the answer. */
	function adopt(asset: AssetItem): void {
		if (cap !== null && pickerSelection.value.length >= cap) {
			notice.value =
				`Added to your library. You are already at ${cap} chosen, so it was not picked.`;
			return;
		}
		if (!multiple) {
			selection.value = [asset.id];
			anchorId.value = asset.id;
			pickerSelection.value = [asset];
			return;
		}
		if (selection.value.includes(asset.id)) return;
		selection.value = [...selection.value, asset.id];
		anchorId.value = asset.id;
		pickerSelection.value = [...pickerSelection.value, asset];
	}

	function confirm(): void {
		const chosen = pickerSelection.value;
		if (chosen.length === 0) return;
		// The answer is handed over BEFORE the close, so a host that reads it synchronously cannot race
		// the next `openPicker` clearing it.
		onPick(chosen);
		dismiss();
	}
	// #endregion

	// #region Move (drag and drop)
	/** Wipe every hover mark the tree targets wrote, whatever ended the drag. */
	function clearDropMarks(): void {
		treeRef.current?.querySelectorAll("[data-dropover]").forEach((el) => {
			el.removeAttribute("data-dropover");
		});
	}

	async function moveInto(assetIds: string[], targetFolderId: string | null): Promise<void> {
		if (assetIds.length === 0 || locationReadOnly.value) return;
		busy.value = true;
		const res = await FilesService.move({ assetIds, targetFolderId });
		busy.value = false;
		if (res.ok) {
			notice.value = null;
			await reload();
		} else {
			notice.value = res.message ?? "Those files could not be moved.";
		}
	}

	function onDragEnd(e: DragEndEvent): void {
		clearDropMarks();
		if (e.canceled || e.over === null) return;
		const over = String(e.over);
		let target: string | null | undefined;
		if (over.startsWith("apk-grid:")) {
			target = over.slice("apk-grid:".length);
		} else if (over.startsWith("apk-tree:")) {
			const row = treeRows.value.find((r) => treeDropId(r.key) === over);
			// A row that vanished mid-drag (a branch collapsed under the pointer) has no destination.
			if (!row || !row.droppable) return;
			target = row.folderId;
		}
		if (target === undefined) return;

		const dragged = String(e.active.id);
		// A drag that started on a selected asset carries the whole selection; a drag from an unselected
		// one carries only itself, which is what a person who never selected anything means by it.
		const payload = selection.value.includes(dragged) ? [...selection.value] : [dragged];
		void moveInto(payload, target);
	}
	// #endregion

	// #region Link + upload
	async function attachLink(): Promise<void> {
		const url = linkUrl.value.trim();
		if (!url || busy.value) return;
		if (!viewerRef.current) {
			notice.value = "Your library is still loading — try again in a moment.";
			return;
		}
		busy.value = true;
		const res = await FilesService.attachLink({
			url,
			folderId: null,
			ownerType: "user",
			ownerId: viewerRef.current,
		}, simRef.current);
		busy.value = false;
		if (res.ok && res.data) {
			linkUrl.value = "";
			notice.value = null;
			adopt(res.data);
		} else {
			notice.value = res.message ?? "That link could not be attached.";
		}
	}

	/**
	 * Run one file through the upload handshake and hand the finished asset to the tray.
	 *
	 * The three steps are the SSOT's: init declares the file and answers with a scoped ticket, the
	 * browser PUTs the bytes straight at that ticket's signed URL (never through an application route —
	 * a 500 MB body would occupy a request worker for minutes and buy nothing), and complete finalises
	 * the row. The duplicate verdict rides on the ticket, so an exact duplicate is answered by handing
	 * back the copy the person already has instead of moving the bytes at all — which is the entire
	 * point of fingerprinting before the upload rather than after it.
	 */
	async function runUpload(file: File): Promise<void> {
		if (!viewerRef.current) {
			notice.value = "Your library is still loading — try again in a moment.";
			return;
		}
		const id = queueKey();
		const task: UploadTask = {
			id,
			file,
			name: file.name,
			sizeBytes: file.size,
			sizeLabel: formatMib(file.size / MIB),
			mimeType: file.type || "application/octet-stream",
			folderId: null,
			phase: "hashing",
			progress: 0,
			fingerprint: null,
			verdict: null,
			resolution: null,
			assetId: null,
			ticket: null,
			error: null,
		};
		enqueueUploads([task]);
		myUploads.value = [...myUploads.value, id];

		// `fingerprintFile` returns `null` — never throws — in an insecure context with no
		// `crypto.subtle`. That is a degraded experience (no duplicate prompt), not a blocked upload.
		const fingerprint = await fingerprintFile(file, {
			onProgress: (fraction) => patchUpload(id, { progress: fraction }),
		}).catch(() => null);

		patchUpload(id, { phase: "checking", fingerprint, progress: 0 });

		// Reading the file runs ALONGSIDE the handshake and the transfer, never before them: the bytes
		// are what the person is waiting for, and a poster frame that is not ready in time is dropped
		// rather than allowed to hold the upload open. See `../core/media/extract.ts`.
		const extraction = extractMetadata(file);

		const init = await FilesService.uploadInit({
			name: file.name,
			mimeType: file.type || "application/octet-stream",
			sizeBytes: file.size,
			fingerprint,
			folderId: null,
			ownerType: "user",
			ownerId: viewerRef.current,
			// Private is the only non-surprising default. Attaching elevates it where the destination
			// requires it (a channel, a public listing); nothing here silently widens access.
			visibility: "private",
		}, simRef.current);

		if (!init.ok || !init.data) {
			patchUpload(id, {
				phase: "blocked",
				error: init.message ?? "That upload could not be started.",
			});
			return;
		}
		const ticket = init.data;
		patchUpload(id, { assetId: ticket.assetId, ticket, verdict: ticket.dedup });

		if (ticket.dedup.verdict === "exact_duplicate" && ticket.dedup.existing) {
			patchUpload(id, { phase: "done", progress: 1, resolution: "link_existing" });
			adopt(ticket.dedup.existing);
			notice.value =
				`You already had ${ticket.dedup.existing.name} — the copy you have was chosen.`;
			return;
		}

		// A stub ticket names no destination, so there are no bytes to move. The row is still finalised,
		// which is what keeps the whole path exercisable while `FILES_BACKEND_LIVE` is off; behind the
		// gate the URL is real and this branch is never taken.
		if (!ticket.signedUrl.startsWith("#")) {
			patchUpload(id, { phase: "uploading", progress: 0 });
			let etag: string | null = null;
			try {
				const put = await fetch(ticket.signedUrl, {
					method: "PUT",
					headers: ticket.headers,
					body: file,
				});
				if (!put.ok) throw new Error(String(put.status));
				etag = put.headers.get("etag");
			} catch {
				patchUpload(id, { phase: "error", error: "Those bytes could not be uploaded." });
				return;
			}
			patchUpload(id, { phase: "finalising", progress: 1, ticket: { ...ticket } });
			const done = await FilesService.uploadComplete({
				assetId: ticket.assetId,
				etag,
				metadata: await awaitExtraction(extraction),
			});
			if (!done.ok || !done.data) {
				patchUpload(id, {
					phase: "error",
					error: done.message ?? "That upload could not be finished.",
				});
				return;
			}
			patchUpload(id, { phase: "done", progress: 1 });
			adopt(done.data);
			return;
		}

		patchUpload(id, { phase: "finalising", progress: 1 });
		const done = await FilesService.uploadComplete({
			assetId: ticket.assetId,
			etag: null,
			metadata: await awaitExtraction(extraction),
		});
		if (!done.ok || !done.data) {
			patchUpload(id, {
				phase: "error",
				error: done.message ?? "That upload could not be finished.",
			});
			return;
		}
		patchUpload(id, { phase: "done", progress: 1 });
		adopt(done.data);
	}

	function onFilesPicked(list: FileList | null): void {
		if (!list || list.length === 0) return;
		for (const file of Array.from(list)) void runUpload(file);
	}
	// #endregion

	// #region Keyboard grid
	/** Columns as the grid ACTUALLY resolved them, so arrow navigation matches what is painted. */
	function columnCount(grid: HTMLElement): number {
		const template = globalThis.getComputedStyle(grid).gridTemplateColumns;
		const columns = template.split(" ").filter((part) => part.trim().length > 0).length;
		return Math.max(1, columns);
	}

	function onGridKey(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const grid = gridRef.current;
		if (!grid) return;
		const cells = Array.from(grid.querySelectorAll<HTMLElement>(".fx-card, .subm-card"));
		if (cells.length === 0) return;
		const current = cells.indexOf(document.activeElement as HTMLElement);
		const cols = columnCount(grid);
		let next = current;
		switch (e.key) {
			case "ArrowRight":
				next = current < 0 ? 0 : current + 1;
				break;
			case "ArrowLeft":
				next = current < 0 ? 0 : current - 1;
				break;
			case "ArrowDown":
				next = current < 0 ? 0 : current + cols;
				break;
			case "ArrowUp":
				next = current < 0 ? 0 : current - cols;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = cells.length - 1;
				break;
			default:
				return;
		}
		if (next < 0 || next >= cells.length) {
			// Clamped rather than wrapped: a wrap at the end of a row lands the caret somewhere the eye
			// did not follow, and in a grid that is indistinguishable from focus being lost.
			e.preventDefault();
			return;
		}
		e.preventDefault();
		cells[next].focus();
	}
	// #endregion

	// #region Mount
	/**
	 * The seam subscription's way back into the CURRENT render's `reload`.
	 *
	 * The subscription is registered once and lives for the island's lifetime, so the closure it
	 * captured is the first render's — and `reload` reads `accept` and `scope`, which are PROPS and
	 * therefore not signals. Without this indirection a dev-axis change would re-read the location with
	 * whatever restriction the host was passing when the picker first mounted.
	 */
	const reloadRef = useRef<() => void>(() => {});
	reloadRef.current = () => {
		if (isOpen) void reload();
	};

	useEffect(() => {
		simRef.current = simFromSeam();
		const unsubscribe = subscribeFilesSim((sim) => {
			simRef.current = sim;
			// The axes are SERVER-derived, so re-rendering would only relabel the same rows — the read
			// has to happen again for the simulated projection to exist at all. The tree is a server
			// projection too, so its cache key is retired alongside the listing.
			treeKeyRef.current = "";
			reloadRef.current();
		});
		return () => {
			unsubscribe();
			if (debounceRef.current !== null) clearTimeout(debounceRef.current);
		};
	}, []);

	/**
	 * Start from a clean location every time the picker opens, and hand the host's selection back when
	 * it closes.
	 *
	 * A picker that reopened where it was last left looks like memory and behaves like a trap: the
	 * second host asking for an avatar would land in whatever folder the first host's attachment search
	 * ended in, with that host's filter still applied.
	 *
	 * **`useEffect`, deliberately, and NOT `useSignalEffect`.** A signal effect subscribes to every
	 * signal read synchronously inside it — and this body READS `search`, `source` and `path` while
	 * also WRITING them, so a signal effect would re-run on the first keystroke and reset the search box
	 * mid-word. Keying a plain effect on the boolean read during render gives the same "on open"
	 * trigger with no subscription at all.
	 */
	useEffect(() => {
		if (!isOpen) {
			// Guarded on having actually been open: this effect also runs on the very first render of a
			// closed picker, and sweeping a SHARED queue then would clear finished uploads belonging to
			// whatever surface is behind it.
			if (restoreRef.current) {
				restoreSelection(restoreRef.current.ids, restoreRef.current.anchor);
				restoreRef.current = null;
				clearFinishedUploads();
			}
			return;
		}
		restoreRef.current = { ids: [...selection.value], anchor: anchorId.value };
		clearSelection();
		pickerSelection.value = [];
		myUploads.value = [];
		notice.value = null;
		linkUrl.value = "";
		search.value = "";
		driveId.value = null;
		source.value = scope !== null ? "project" : "library";
		expanded.value = new Set([ROOT_KEY]);
		tree.value = [];
		treeKeyRef.current = "";
		resetLocation();
		void reload();
	}, [isOpen]);
	// #endregion

	// #region Derived
	/** Rows the accept filter admits. The server narrows by KIND; this is the category half. */
	const visibleItems = useComputed(() =>
		accept.categories.length === 0 ? items.value : items.value.filter((a) => accepts(accept, a))
	);

	const treeRows = useComputed(() => visibleTreeRows(tree.value, expanded.value));

	/**
	 * The tree root's muted count.
	 *
	 * Summed from the ROOTS, whose `fileCount` is already their whole subtree's — never a literal 0,
	 * which would print a count that is untrue of any library that has files in it.
	 */
	const rootCount = useComputed(() =>
		tree.value.reduce((total, node) => total + node.fileCount, 0)
	);

	const chosenIds = useComputed(() => new Set(pickerSelection.value.map((a) => a.id)));
	const count = pickerSelection.value.length;
	const atCap = cap !== null && count >= cap;

	const inspected = inspectId.value
		? items.value.find((a) => a.id === inspectId.value) ??
			pickerSelection.value.find((a) => a.id === inspectId.value) ?? null
		: null;

	const spec = SOURCES.find((s) => s.key === source.value) ?? SOURCES[1];
	const loc = locationOf(source.value);
	const crumbs = breadcrumbsFor(path.value, { base: "/files", rootLabel: loc.rootLabel });
	const narrowed = search.value.trim().length > 0;
	const mine = useComputed(() => {
		const ids = new Set(myUploads.value);
		return uploadQueue.value.filter((t) => ids.has(t.id));
	});
	// #endregion

	// #region Workspace
	function workspace(): JSX.Element {
		if (source.value === "link") return linkPanel();
		if (source.value === "upload") return uploadPanel();
		if (source.value === "drives" && driveId.value === null) return drivePrompt();

		if (error.value && !seeded.value) {
			return (
				<div class="apk-state apk-state--error" role="alert">
					<p class="apk-state__title">These files could not be loaded</p>
					<p class="apk-state__note">{error.value}</p>
					<Button variant="outlined" size="sm" label="Try again" onClick={() => commit()} />
				</div>
			);
		}

		if (!seeded.value && loading.value) {
			return (
				<div class="apk-state" role="status">
					<p class="apk-state__note">Loading your files…</p>
				</div>
			);
		}

		if (seeded.value && folders.value.length === 0 && visibleItems.value.length === 0) {
			return (
				<div class="apk-state" role="status">
					<p class="apk-state__title">
						{narrowed ? "Nothing matches" : `No ${accept.noun ?? "files"} here`}
					</p>
					<p class="apk-state__note">
						{narrowed
							? `No ${accept.noun ?? "files"} in this location match that search.`
							: accept.active
							? `This picker is only accepting ${accept.noun}. There are none in this location.`
							: "Files you upload, and links you save, will appear here."}
					</p>
					{narrowed
						? (
							<Button
								variant="text"
								size="sm"
								label="Clear search"
								onClick={() => {
									search.value = "";
									commit();
								}}
							/>
						)
						: null}
				</div>
			);
		}

		return (
			<>
				<div
					class="apk-grid"
					ref={gridRef}
					role="group"
					aria-label="Files and folders"
					onKeyDown={onGridKey}
				>
					{folders.value.map((folder) => (
						<PickerFolderCell key={`f:${folder.id}`} folder={folder} onOpen={openFolder} />
					))}
					{visibleItems.value.map((asset) => {
						const selected = chosenIds.value.has(asset.id);
						// A card that cannot be picked is disabled rather than hidden: the file is still
						// there, and hiding it would look like it had gone.
						const blocked = !selected && atCap && multiple
							? `You can choose up to ${cap} ${cap === 1 ? "file" : "files"}.`
							: null;
						return (
							<PickerAssetCell
								key={`a:${asset.id}`}
								asset={asset}
								selected={selected}
								blockedReason={blocked}
								onSelect={onSelect}
								onBlocked={(reason) => (notice.value = reason)}
								onInspect={(a) => (inspectId.value = a.id)}
								onOpenRaw={openRaw}
								dragCount={selection.value.length}
								movable={!locationReadOnly.value}
							/>
						);
					})}
				</div>

				{error.value && seeded.value
					? (
						<p class="apk-tail-error" role="alert">
							<Icon name="warning" size="2xs" aria-hidden="true" />
							<span>{error.value}</span>
						</p>
					)
					: null}

				{hasMore.value
					? (
						<div class="apk-more">
							<Button
								variant="outlined"
								size="sm"
								label={loading.value ? "Loading…" : "Show more"}
								disabled={loading.value}
								onClick={() => void loadMore()}
							/>
						</div>
					)
					: null}
			</>
		);
	}

	function drivePrompt(): JSX.Element {
		if (drives.value.length === 0) {
			return (
				<div class="apk-state" role="status">
					<p class="apk-state__title">No drives connected</p>
					<p class="apk-state__note">
						Connecting a drive is a separate permission from signing in. You can link one from your
						Files page, then browse it here without copying anything.
					</p>
					<a class="apk-state__link" href="/files">Open Files</a>
				</div>
			);
		}
		return (
			<div class="apk-state" role="status">
				<p class="apk-state__title">Choose a drive</p>
				<p class="apk-state__note">
					A connected drive is read-only here — attaching from it links to the file where it lives.
				</p>
			</div>
		);
	}

	function linkPanel(): JSX.Element {
		return (
			<div class="apk-form">
				<label class="apk-form__label" for="apk-link-url">Link address</label>
				<InputText
					id="apk-link-url"
					value={linkUrl.value}
					type="url"
					placeholder="https://…"
					block
					onValueChange={(v: string) => (linkUrl.value = v)}
				/>
				<p class="apk-form__hint">
					A link is stored as a file in its own right, so you can find it beside everything else.
					Only <code>https://</code> addresses can be attached.
				</p>
				<div class="apk-form__actions">
					<Button
						variant="filled"
						size="sm"
						label="Save and choose"
						loading={busy.value}
						disabled={busy.value || linkUrl.value.trim().length === 0}
						onClick={() => void attachLink()}
					/>
				</div>
			</div>
		);
	}

	function uploadPanel(): JSX.Element {
		return (
			<div class="apk-form">
				<div
					class="apk-drop"
					onDragOver={(e: JSX.TargetedEvent<HTMLDivElement, DragEvent>) => {
						// Without `preventDefault` the browser navigates to the dropped file instead, which
						// discards the page — and with it the selection the person has already made.
						e.preventDefault();
						e.currentTarget.dataset.over = "true";
					}}
					onDragLeave={(e: JSX.TargetedEvent<HTMLDivElement, DragEvent>) => {
						delete e.currentTarget.dataset.over;
					}}
					onDrop={(e: JSX.TargetedEvent<HTMLDivElement, DragEvent>) => {
						e.preventDefault();
						delete e.currentTarget.dataset.over;
						onFilesPicked(e.dataTransfer?.files ?? null);
					}}
				>
					<Icon name="upload" size="lg" aria-hidden="true" />
					<p class="apk-drop__title">Drop files here</p>
					<p class="apk-drop__note">
						{accept.active
							? `This picker is accepting ${accept.noun}.`
							: "They are added to your library, then chosen for you."}
					</p>
					<Button
						variant="outlined"
						size="sm"
						label="Choose from this device"
						onClick={() => fileInputRef.current?.click()}
					/>
				</div>

				{mine.value.length > 0
					? (
						<ul class="apk-queue" role="list" aria-label="Uploads">
							{mine.value.map((task) => (
								<li class="apk-queue__row" key={task.id} data-phase={task.phase}>
									<span class="apk-queue__name" title={task.name}>{task.name}</span>
									<span class="apk-queue__size">{task.sizeLabel}</span>
									<span class="apk-queue__phase">{uploadPhaseLabel(task)}</span>
								</li>
							))}
						</ul>
					)
					: null}
			</div>
		);
	}
	// #endregion

	if (!isOpen) return <div class="apk-host" />;

	return (
		<div class="apk-host">
			<BodyPortal>
				<div class="apk" style={`--apk-z:${stack.zIndex}`}>
					<Backdrop
						visible
						onClick={pickerSelection.value.length === 0 ? dismiss : undefined}
					/>
					<div
						ref={panelRef}
						class="apk__panel"
						data-state="open"
						role="dialog"
						aria-modal="true"
						aria-label={title}
						tabIndex={-1}
					>
						{/* #region Header */}
						<header class="apk__top">
							<div class="apk__ident">
								<h2 class="apk__title">{title}</h2>
								<p class="apk__sub">
									{accept.active
										? `Choose ${multiple ? accept.noun : `one of your ${accept.noun}`}`
										: multiple
										? "Choose one or more of your files"
										: "Choose one of your files"}
									{cap !== null && multiple ? ` · up to ${cap}` : ""}
								</p>
							</div>
							<Tooltip content={navOpen.value ? "Hide sources" : "Show sources"}>
								<button
									type="button"
									class="apk__act"
									aria-label={navOpen.value ? "Hide sources" : "Show sources"}
									aria-pressed={navOpen.value ? "true" : "false"}
									onClick={() => (navOpen.value = !navOpen.value)}
								>
									<Icon name="menu" size="sm" />
								</button>
							</Tooltip>
							<button
								type="button"
								class="apk__act apk__act--close"
								aria-label="Close"
								onClick={dismiss}
							>
								<Icon name="close" size="sm" />
							</button>
						</header>
						{/* #endregion */}

						{/* #region Body — the three-pane workspace */}
						<div class="apk__body" data-busy={busy.value ? "true" : undefined}>
							<DndContext onDragEnd={onDragEnd}>
								{
									/*
									 * `layout="horizontal"` is not decoration. `splitter.css` ships a BARE
									 * `.ui-splitter` rule (0,1,0) that pins the nav lane's 280px width and is loaded
									 * globally by the shell islands; only the compound
									 * `.ui-splitter.ui-splitter--horizontal` (0,2,0) outranks it. Without the
									 * modifier this whole workspace collapses to a lane.
									 *
									 * `key` remounts the splitter whenever the PANE COUNT changes. `Splitter`
									 * resolves its size array once, on mount, so a pane appearing later would be
									 * handed an undefined width — the persisted key is varied with it for the same
									 * reason.
									 */
								}
								<Splitter
									key={`apk-${navOpen.value ? "n" : ""}${inspected ? "i" : ""}`}
									layout="horizontal"
									class="apk__split"
									stateKey={`asset-picker-${navOpen.value ? "n" : ""}${inspected ? "i" : ""}`}
								>
									{navOpen.value
										? (
											<SplitterPanel size={22} minSize={14} maxSize={34} class="apk-nav">
												<nav class="apk-nav__inner" aria-label="Where to look">
													<ul class="apk-nav__sources" role="list">
														{activeSources.value.map((item) => (
															<li key={item.key}>
																<button
																	type="button"
																	class="apk-nav__source"
																	aria-current={source.value === item.key ? "true" : undefined}
																	onClick={() => pickSource(item.key)}
																>
																	<Icon name={item.icon} size="xs" />
																	<span>{item.label}</span>
																</button>

																{item.key === "drives" && source.value === "drives"
																	? (
																		<ul class="apk-nav__drives" role="list">
																			{drives.value.map((drive) => (
																				<li key={drive.id}>
																					<button
																						type="button"
																						class="apk-nav__drive"
																						aria-current={driveId.value === drive.id
																							? "true"
																							: undefined}
																						onClick={() => {
																							driveId.value = drive.id;
																							resetLocation();
																							void reload();
																						}}
																					>
																						<SourceMark source={drive.source} size={14} />
																						<span>{drive.label}</span>
																					</button>
																				</li>
																			))}
																		</ul>
																	)
																	: null}
															</li>
														))}
													</ul>

													{
														/*
														 * The tree is the library's own shape and only ever describes a
														 * BROWSABLE source. It is absent — not disabled — on the two sources
														 * that produce a file rather than find one, because there is no
														 * hierarchy to be in the middle of.
														 */
													}
													{BROWSING.has(source.value) && loc.scope !== "drive" &&
															tree.value.length > 0
														? (
															<div class="apk-nav__tree" ref={treeRef}>
																<AssetTree
																	tree={tree.value}
																	rootLabel={loc.rootLabel}
																	rootCount={rootCount.value}
																	currentPath={path.value}
																	expanded={expanded}
																	onNavigate={navigate}
																	aria-label="Folders"
																/>
																{treeRows.value.map((row, index) => (
																	<TreeDropTarget
																		key={row.key}
																		row={row}
																		index={index}
																		containerRef={treeRef}
																	/>
																))}
															</div>
														)
														: null}
												</nav>
											</SplitterPanel>
										)
										: null}

									<SplitterPanel
										size={inspected ? (navOpen.value ? 54 : 76) : (navOpen.value ? 78 : 100)}
										minSize={40}
										class="apk-main"
									>
										<div class="apk-main__bar">
											{BROWSING.has(source.value)
												? (
													<AssetBreadcrumbs
														crumbs={crumbs}
														base="/files"
														onNavigate={navigate}
														aria-label="Folder path"
													/>
												)
												: <p class="apk-main__note">{spec.note}</p>}

											{BROWSING.has(source.value)
												? (
													<InputText
														value={search}
														type="search"
														placeholder="Search this location"
														aria-label="Search this location"
														class="apk-main__search"
														start={<Icon name="search" size="xs" aria-hidden="true" />}
														onValueChange={() => commit(true)}
													/>
												)
												: null}
										</div>

										{locationReadOnly.value && BROWSING.has(source.value)
											? (
												<p class="apk-main__readonly">
													<Icon name="lock" size="2xs" aria-hidden="true" />
													<span>
														Read-only here. You can browse and attach; changes are made where these
														files live.
													</span>
												</p>
											)
											: null}

										<div class="apk-main__scroll">{workspace()}</div>
									</SplitterPanel>

									{inspected
										? (
											<SplitterPanel size={24} minSize={16} maxSize={36} class="apk-side">
												{
													/*
													 * Capability → ABSENCE, not a disabled control (the `/wallet` rule).
													 * A picker is not the place to change who can see a file or to delete
													 * one: both are library decisions with consequences well outside the
													 * task in hand, and a destructive control beside a "choose" control is
													 * a misclick with no undo. `InspectPanel` renders its manage block only
													 * when `canManage`, so the pane is handed a projection with that flag
													 * cleared — the controls are not there to press, rather than there and
													 * refusing. The row's real `canManage` still governs drag-to-move,
													 * which is the one library change this surface does offer.
													 */
												}
												<InspectPanel
													asset={{ ...inspected, canManage: false }}
													busy={busy.value}
													onClose={() => (inspectId.value = null)}
													onDownload={(asset) => void download(asset)}
													onOpenRaw={openRaw}
													onSetVisibility={() => {}}
													onDelete={() => {}}
												/>
											</SplitterPanel>
										)
										: null}
								</Splitter>

								<DragOverlay class="apk-ghost">
									<span class="apk-ghost__chip">
										{selection.value.length > 1 ? `${selection.value.length} files` : "Move file"}
									</span>
								</DragOverlay>
							</DndContext>
						</div>
						{/* #endregion */}

						{/* #region Footer — the tray, the allowance, the action */}
						<footer class="apk__foot">
							<div class="apk-tray" role="group" aria-label="Chosen files">
								{count === 0
									? (
										<p class="apk-tray__empty">
											{accept.active
												? `Nothing chosen yet — pick ${
													multiple ? accept.noun : `one of your ${accept.noun}`
												}.`
												: "Nothing chosen yet."}
										</p>
									)
									: (
										<ul class="apk-tray__list" role="list">
											{pickerSelection.value.map((asset) => (
												<li class="apk-tray__item" key={asset.id}>
													<span class="apk-tray__thumb" aria-hidden="true">
														{asset.thumbnailUrl &&
																(asset.kind === "image" || asset.kind === "video")
															? <img src={asset.thumbnailUrl} alt="" loading="lazy" />
															: <FileKindIcon kind={asset.kind} size={16} />}
													</span>
													<span class="apk-tray__name" title={asset.name}>{asset.name}</span>
													<Tooltip content={`Remove ${asset.name}`}>
														<button
															type="button"
															class="apk-tray__drop"
															aria-label={`Remove ${asset.name}`}
															onClick={() =>
																removeFromTray(asset.id)}
														>
															<Icon name="close" size="2xs" />
														</button>
													</Tooltip>
												</li>
											))}
										</ul>
									)}
							</div>

							{quota.value
								? (
									<div class="apk__quota">
										<QuotaMeter quota={quota.value} compact />
									</div>
								)
								: null}

							<div class="apk__actions">
								{notice.value ? <p class="apk__notice" role="status">{notice.value}</p> : null}
								<Button variant="text" label="Cancel" onClick={dismiss} />
								{
									/*
									 * Disabled with the reason stated beside it, never a silently inert button: at
									 * zero the control is the only thing on screen that could explain what is
									 * missing, and a press that does nothing explains nothing.
									 */
								}
								<Button
									variant="filled"
									label={count > 0 ? `Attach Selected (${count})` : "Attach Selected"}
									disabled={count === 0}
									aria-describedby={count === 0 ? "apk-attach-why" : undefined}
									onClick={confirm}
								/>
								{count === 0
									? (
										<span class="apk__why" id="apk-attach-why">
											Choose at least one file first.
										</span>
									)
									: null}
							</div>
						</footer>
						{/* #endregion */}
					</div>

					{
						/*
						 * Outside the panel and visually hidden rather than `display: none`: a hidden input is not
						 * clickable, and this one is driven by the drop zone's button.
						 */
					}
					<input
						ref={fileInputRef}
						class="apk__file"
						type="file"
						multiple={multiple}
						accept={accept.attr || undefined}
						tabIndex={-1}
						aria-hidden="true"
						onChange={(e) => {
							const el = e.currentTarget as HTMLInputElement;
							onFilesPicked(el.files);
							// Reset, or picking the same file twice in a row fires no change event at all.
							el.value = "";
						}}
					/>
				</div>
			</BodyPortal>
		</div>
	);
}

// #region Vocabulary
/** Map a connector slug onto the storage source its brand mark is registered under. */
function providerSource(slug: string): AssetSource {
	switch (slug) {
		case "google_drive":
			return "google_drive";
		case "dropbox":
			return "dropbox";
		case "frameio":
			return "frameio";
		case "s3":
			return "s3";
		default:
			return "supabase";
	}
}

/**
 * One upload row's state, in words.
 *
 * Every phase gets its own sentence because each one fails differently and each is worth showing:
 * `hashing` is CPU on this machine, `checking` is a round trip, `uploading` is bytes leaving. Folding
 * them into "uploading" reports a 400 MB file as stuck at 0% for the twenty seconds it is being
 * digested.
 */
function uploadPhaseLabel(task: UploadTask): string {
	switch (task.phase) {
		case "queued":
			return "Waiting";
		case "hashing":
			return `Checking for duplicates… ${Math.round(task.progress * 100)}%`;
		case "checking":
			return "Asking your library";
		case "ready":
			return "Ready";
		case "uploading":
			return "Uploading";
		case "finalising":
			return "Finishing";
		case "done":
			return "Added";
		case "blocked":
			return task.error ?? "Refused";
		case "error":
			return task.error ?? "Failed";
		case "cancelled":
			return "Cancelled";
	}
}
// #endregion
