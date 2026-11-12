import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-chrome.css";
import "../styles/files-hub.css";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneList,
	type MenuItem,
	TreeNav,
	type TreeNavNode,
} from "@projective/ui/navigation";
import { LaneSearchField } from "@features/shortcuts/components/LaneSearchField.tsx";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { statusMark, TREE_MARK } from "../components/AssetTree.tsx";
import { folderColorRow } from "../components/FolderColorGrid.tsx";
import { FolderMark } from "../components/FolderMark.tsx";
import { QuotaMeter } from "../components/QuotaMeter.tsx";
import { NodeMark } from "../components/file-hub-glyphs.tsx";
import { FilesService } from "../core/FilesService.ts";
import { IntegrationsService } from "../core/IntegrationsService.ts";
import { pathKey } from "../core/asset-model.ts";
import { dropAttrs } from "../core/files-dnd.ts";
import {
	allRowKeys,
	DRIVES_KEY,
	filterRows,
	type LaneNode,
	laneTree,
	lazyPrefixes,
	LIBRARY_KEY,
	type LoadedChildren,
	openChain,
	PROJECTS_KEY,
	type RowAction,
	rowActionsOf,
	selectedRow,
	treePath,
} from "../core/files-tree.ts";
import {
	askNewFolder,
	connectDriveOpen,
	currentPath,
	currentScope,
	disconnectOpen,
	goTo,
	pendingDisconnect,
	pendingRemoval,
	quota,
	removalOpen,
	seeded,
	subjectId as subjectIdSignal,
	tree,
	treeRevision,
} from "../core/files-state.ts";
import { recentPress } from "../core/press-point.ts";
import type { AssetNodeKind, FileScope } from "../types/file-types.ts";

/**
 * FilesLane — the `/files` middle-nav lane: one tree, and the allowance.
 *
 * ## One tree, three roots
 *
 * Library, Projects and Connected Drives are ordinary rows of a single {@link TreeNav}, so a root folds
 * and reads exactly as a folder inside it does. They still separate populations that behave differently
 * (`core/files-tree.ts` holds the model): the library is writable, while a project or a drive is
 * read-only as a LOCATION, never a second write path into someone else's system of record. Their rows
 * therefore take no drops and offer no New Folder. A project's submissions and a drive's folders are
 * read when their row is opened, because neither can be bounded in the tree's one payload.
 *
 * ## Two presentations, one DOM
 *
 * The expanded stack and the collapsed icon rail are BOTH rendered and CSS reveals exactly one, keyed
 * off the splitter's `data-mode` — the shipped repo pattern (`ProjectSidebar`, `WalletLane`,
 * `CatalogueLane`). A client width observer would paint the wrong presentation for a frame on every
 * load, and a navigation tree that flickers between two shapes reads as a broken lane.
 *
 * ## Why it fetches its own tree
 *
 * `laneFor` in `(dashboard)/_layout.tsx` hands the lane no data (see `files-lane-slot.tsx`), so it
 * reads `files-state.tree`, which the server-rendered BODY publishes when it seeds, and issues its own
 * `FilesService.tree` read on mount and after any structural write ({@link treeRevision}). Both are the
 * same server projection, so they cannot disagree.
 *
 * Every row move goes through the body (`goTo`), the single fetch owner. Dumb island: it calls
 * `/api/files/*` through the thin service and touches no database.
 */

// #region Props
export interface FilesLaneProps {
	scope: FileScope;
	subjectId: string | null;
	/** The folder path within the scope; `[]` is the scope root. */
	segments: string[];
	ownerId: string;
}
// #endregion

// #region Row rendering
function rowIcon(row: LaneNode): JSX.Element {
	if (row.key === PROJECTS_KEY) return <Icon name="projects" />;
	if (row.key === DRIVES_KEY) return <Icon name="box" />;
	if (row.nodeKind === "root" || row.nodeKind === "folder") {
		return <FolderMark color={row.color} folderId={row.folderId} size={TREE_MARK} />;
	}
	return <NodeMark nodeKind={row.nodeKind as AssetNodeKind} />;
}

/** The library root and a writable folder take drops; a mounted row refuses them by having no target. */
function rowDrop(row: LaneNode): Record<`data-${string}`, string> | null {
	if (row.readOnly) return null;
	if (row.key === LIBRARY_KEY) return dropAttrs(null);
	return row.folderId ? dropAttrs(row.folderId) : null;
}

function toNavNode(row: LaneNode): TreeNavNode {
	return {
		key: row.key,
		label: row.label,
		sublabel: row.sublabel ?? undefined,
		icon: rowIcon(row),
		avatar: row.avatar ? { image: row.avatar, label: row.label } : null,
		status: row.nodeKind === "project" || row.nodeKind === "drive"
			? statusMark({ readOnly: row.readOnly })
			: null,
		count: row.fileCount,
		children: row.children.map(toNavNode),
		expandable: row.lazy,
		grouping: row.path === null,
		attrs: rowDrop(row),
	};
}

function flatten(rows: readonly LaneNode[]): LaneNode[] {
	return rows.flatMap((row) => [row, ...flatten(row.children)]);
}

/** The ghost settings gear: file settings are the connected drives, in Settings. */
function SettingsGear(props: { placement?: "right" }): JSX.Element {
	return (
		<Tooltip content="File settings" placement={props.placement}>
			<Button
				iconOnly
				rounded
				size="sm"
				variant="text"
				severity="secondary"
				class="ui-hit"
				icon={<Icon name="settings" size="sm" />}
				aria-label="File settings"
				onClick={() => void openSettings("integrations", "storage")}
			/>
		</Tooltip>
	);
}
// #endregion

export default function FilesLane(props: FilesLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const query = useSignal("");
	const expanded = useSignal<Set<string>>(new Set([LIBRARY_KEY, PROJECTS_KEY, DRIVES_KEY]));
	const loaded = useSignal<LoadedChildren>({});
	/** A lane-local transport failure. Never blanks the tree it already has (see `load`). */
	const treeError = useSignal<string | null>(null);
	const loadingTree = useSignal(false);
	const loading = useRef(new Set<string>());

	// #region Data
	/**
	 * Read the tree (and, in the hub, the allowance) for this scope.
	 *
	 * Both branches of every response are handled: a failure records a lane-local message and leaves
	 * the previous tree standing, because silently keeping stale navigation on screen with no
	 * indication is the defect this codebase has shipped before (`if (res.ok && res.data)` with no
	 * `else`). The tree is only REPLACED on success.
	 */
	async function load(): Promise<void> {
		if (!props.ownerId) return;
		loadingTree.value = true;
		const res = await FilesService.tree();
		if (res.ok && res.data) {
			tree.value = res.data;
			treeError.value = null;
		} else {
			treeError.value = res.message ?? "The folder tree could not be loaded.";
		}
		loadingTree.value = false;

		// The allowance is a `hub` fact. A mount and a share consume none, and writing a `null` from a
		// drive read would blank a meter the body had correctly filled.
		if (props.scope !== "hub") return;
		const q = await FilesService.quota();
		if (q.ok && q.data) quota.value = q.data;
	}

	/** Read the children under a project or a drive folder, once. A failure can be retried by reopening. */
	async function loadChildren(path: string[]): Promise<void> {
		const key = pathKey(path);
		if (loaded.peek()[key] !== undefined || loading.current.has(key)) return;
		loading.current.add(key);
		const res = await FilesService.treeChildren(path);
		loading.current.delete(key);
		if (res.ok && res.data) loaded.value = { ...loaded.peek(), [key]: res.data };
		else treeError.value = res.message ?? "That location could not be opened.";
	}

	useEffect(() => {
		// Seed the shared location so the body's first commit reads the URL, not a stale scope.
		currentScope.value = props.scope;
		subjectIdSignal.value = props.subjectId;
		currentPath.value = props.segments;

		try {
			const el = globalThis.document?.querySelector(".ui-splitter") as HTMLElement | null;
			collapsed.value = el?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }

		void load().then(reportConsent);
	}, []);

	/** The consent round trip's outcome is a coarse marker on the URL it came back to. */
	function reportConsent(): void {
		const url = new URL(globalThis.location.href);
		const outcome = IntegrationsService.completionFrom(url);
		if (!outcome) return;
		if (outcome === "failed") treeError.value = "That drive could not be connected. Try again.";
		url.searchParams.delete("connect");
		history.replaceState(history.state, "", url.pathname + url.search + url.hash);
	}

	// A structural write anywhere, from a menu here or from the body, re-reads the tree.
	useSignalEffect(() => {
		if (treeRevision.value > 0) void load();
	});

	// The row in view is always reachable: its ancestors open whenever the location changes, and a deep
	// link reads each lazy level on its way down. Only ever a widening, so a person's own collapse of an
	// unrelated branch survives.
	useSignalEffect(() => {
		const at = treePath(tree.value, currentPath.value);
		const open = new Set(expanded.peek());
		for (const key of openChain(at)) open.add(key);
		if (open.size !== expanded.peek().size) expanded.value = open;
		for (const prefix of lazyPrefixes(at)) void loadChildren(prefix);
	});
	// #endregion

	// #region Navigation
	function setLaneCollapsed(next: boolean): void {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR — non-fatal */ }
	}
	// #endregion

	// #region Derived tree
	const q = useComputed(() => query.value.trim().toLowerCase());
	const rows = useComputed(() => filterRows(laneTree(tree.value, loaded.value), q.value));
	const index = useComputed(() => new Map(flatten(rows.value).map((row) => [row.key, row])));
	const matches = useComputed(() => rows.value.some((row) => row.children.length > 0));

	// A search that matched deep in the tree must SHOW its matches, so a live query force-opens every
	// surviving branch. In an effect, since writing a signal while rendering re-enters the render.
	useSignalEffect(() => {
		if (!q.value) return;
		const open = new Set(expanded.peek());
		for (const key of allRowKeys(rows.value)) open.add(key);
		// Only ever a widening, so it cannot fight the person's own collapse mid-search.
		if (open.size !== expanded.peek().size) expanded.value = open;
	});

	const selectedKey = selectedRow(tree.value, seeded.value ? currentPath.value : props.segments);
	// #endregion

	// #region Row menus
	function menuRow(action: RowAction, row: LaneNode): MenuItem {
		switch (action) {
			case "folder-color":
				return folderColorRow({
					folderId: row.folderId ?? "",
					name: row.label,
					color: row.color,
				});
			case "new-folder":
				return {
					key: action,
					label: "New Folder",
					icon: "folder",
					command: () => askNewFolder(row.key === LIBRARY_KEY ? null : row.folderId, recentPress()),
				};
			case "delete-folder":
				return {
					key: action,
					label: "Delete Folder",
					icon: "trash",
					danger: true,
					command: () => {
						pendingRemoval.value = {
							assetIds: [],
							folderIds: row.folderId ? [row.folderId] : [],
							name: row.label,
						};
						removalOpen.value = true;
					},
				};
			case "connect-drive":
				return {
					key: action,
					label: "Connect Drive",
					icon: "link",
					command: () => (connectDriveOpen.value = true),
				};
			case "disconnect-drive":
				return {
					key: action,
					label: "Disconnect Drive",
					icon: "close",
					danger: true,
					command: () => {
						pendingDisconnect.value = { connectionId: row.connectionId ?? "", name: row.label };
						disconnectOpen.value = true;
					},
				};
		}
	}

	function rowActions(node: TreeNavNode): MenuItem[] {
		const row = index.value.get(node.key);
		return (row ? rowActionsOf(row) : []).flatMap((action) =>
			action === "folder-color"
				? [{ separator: true }, menuRow(action, row!), { separator: true }]
				: [menuRow(action, row!)]
		);
	}
	// #endregion

	/** The top-level library folders the collapsed rail offers as direct jumps. */
	const railFolders = useComputed(() => rows.value[0]?.children.slice(0, 7) ?? []);

	return (
		<div class="fh-lanewrap">
			{/* Collapsed presentation — revealed by CSS at the rail density. */}
			<div class="fh-rail">
				<Tooltip content="Library" placement="right">
					<button
						type="button"
						class="fh-rail__item"
						data-active={props.segments.length === 0 ? "true" : undefined}
						aria-label="Library root"
						onClick={() => goTo([])}
					>
						<FolderMark size={TREE_MARK} />
					</button>
				</Tooltip>

				<div class="fh-rail__items" role="list">
					{railFolders.value.map((row) => (
						<Tooltip key={row.key} content={row.label} placement="right">
							<button
								type="button"
								class="fh-rail__item"
								role="listitem"
								data-active={selectedKey === row.key ? "true" : undefined}
								aria-label={row.label}
								onClick={() =>
									goTo(row.path ?? [])}
							>
								{rowIcon(row)}
							</button>
						</Tooltip>
					))}
				</div>

				<div class="fh-rail__bottom">
					{quota.value && (
						<Tooltip content={`${Math.round(quota.value.pct)}% of storage used`} placement="right">
							<span class="fh-rail__quota">
								<QuotaMeter quota={quota.value} compact />
							</span>
						</Tooltip>
					)}
					<SettingsGear placement="right" />
					<LaneCollapseButton
						collapsed
						icon={<SidebarToggleIcon />}
						tooltipPlacement="right"
						onToggle={() => setLaneCollapsed(false)}
					/>
				</div>
			</div>

			{/* Expanded presentation. */}
			<div class="fh-lane">
				<LaneHead class="fh-lane__head">
					<LaneBar>
						<LaneSearchField
							value={query.value}
							placeholder="Find a folder"
							label="Find a folder in this library"
							icon={<Icon name="search" />}
							onInput={(v) => (query.value = v)}
						/>
					</LaneBar>
				</LaneHead>

				<LaneList label="File locations" class="fh-lane__tree" busy={loadingTree.value}>
					{treeError.value && <p class="fh-lane__error" role="status">{treeError.value}</p>}

					{q.value && !matches.value
						? (
							<LaneEmpty
								title="No folder matches"
								note="Try a shorter term, or clear the search."
								icon={<Icon name="folder" />}
							/>
						)
						: (
							<TreeNav
								nodes={rows.value.map(toNavNode)}
								selectedKey={selectedKey}
								expanded={expanded}
								onSelect={(node) => {
									const path = index.value.get(node.key)?.path;
									if (path) goTo(path);
								}}
								onToggle={(node, open) => {
									const row = index.value.get(node.key);
									if (open && row?.lazy && row.path) void loadChildren(row.path);
								}}
								rowActions={rowActions}
								aria-label="File locations"
							/>
						)}
				</LaneList>

				{
					/*
					 * The allowance sits at the foot of the lane, not in the body: it is a standing fact about
					 * this library rather than a row of it, and it has to stay legible while the workspace
					 * scrolls. `null` (a mount, a share) renders nothing at all rather than an empty meter.
					 */
				}
				{quota.value && (
					<div class="fh-lane__quota">
						<QuotaMeter quota={quota.value} />
					</div>
				)}

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setLaneCollapsed(!collapsed.value)}
					/>
					<LaneFooterActions>
						<SettingsGear />
					</LaneFooterActions>
				</LaneFooter>
			</div>
		</div>
	);
}
