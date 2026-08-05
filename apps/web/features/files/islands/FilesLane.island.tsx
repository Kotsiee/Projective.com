import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/files-chrome.css";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneHead,
	LaneList,
	LaneSearch,
	LaneSection,
	LaneSections,
	TreeNav,
	type TreeNavNode,
} from "@projective/ui/navigation";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { QuotaMeter } from "../components/QuotaMeter.tsx";
import { NodeMark } from "../components/file-hub-glyphs.tsx";
import { FilesService } from "../core/FilesService.ts";
import { simFromSeam, subscribeFilesSim } from "../core/files-seam.ts";
import { ancestorKeys, assetHref, pathKey } from "../core/asset-model.ts";
import {
	commitFiles,
	currentPath,
	currentScope,
	quota,
	subjectId as subjectIdSignal,
	tree,
} from "../core/files-state.ts";
import type { AssetOwnerType, AssetTreeNode, FileScope } from "../types/file-types.ts";

/**
 * FilesLane — the `/files` middle-nav lane: the directory tree, the scope map, and the allowance.
 *
 * ## Two presentations, one DOM
 *
 * The expanded stack and the collapsed icon rail are BOTH rendered and CSS reveals exactly one, keyed
 * off the splitter's `data-mode` — the shipped repo pattern (`ProjectSidebar`, `WalletLane`,
 * `CatalogueLane`). A client width observer would paint the wrong presentation for a frame on every
 * load, and a navigation tree that flickers between two shapes reads as a broken lane.
 *
 * ## What the lane owns, and what it does not
 *
 * Navigation and scope ONLY (the region contract). The tree separates three populations that behave
 * differently and must not be conflated:
 *
 *  - **My library** — hub-native folders the owner created. Writable.
 *  - **Mounted** — project and channel attachments, surfaced so a person can FIND what they already
 *    have. Read-only as a LOCATION (`AssetListPage.readOnly`), which is why they are a separate,
 *    separately-labelled section rather than folders with a badge.
 *  - **Connected drives** — third-party accounts. Read-only for the same reason, and never a second
 *    write path into someone else's system of record.
 *
 * ## Why it fetches its own tree
 *
 * `laneFor` in `(dashboard)/_layout.tsx` is synchronous and `FilesBackendService` is async, so the slot
 * cannot resolve the tree server-side without making the shared dashboard layout an async component
 * (see the note in `files-lane-slot.tsx`). The lane therefore reads `files-state.tree` — which the
 * server-rendered BODY publishes when it seeds — and issues its own `FilesService.tree` read on mount
 * so the lane is never empty on a route the body has not yet hydrated. Whichever lands first wins;
 * both are the same server projection, so they cannot disagree.
 *
 * Dumb island: it calls `/api/files/*` through the thin service and touches no database.
 */

// #region Props
export interface FilesLaneProps {
	/** The current pathname — drives the active row without a client-side router. */
	path: string;
	/** The route base every deep link in this scope hangs off (`/files`, `/files/drives/{id}`). */
	base: string;
	scope: FileScope;
	subjectId: string | null;
	/** The folder path within the scope; `[]` is the scope root. */
	segments: string[];
	ownerType: AssetOwnerType;
	ownerId: string;
	/** What to call this library — "My files", or the acting workspace's handle. */
	ownerLabel: string;
}

/** The three populations the tree is partitioned into. Order is the reading order of the lane. */
type SectionKey = "library" | "mounted" | "drives";

interface SectionSpec {
	key: SectionKey;
	label: string;
	icon: JSX.Element;
	/** The empty-state sentence — different per section because the reasons differ. */
	empty: string;
}
// #endregion

// #region Section model
const SECTIONS: readonly SectionSpec[] = [
	{
		key: "library",
		label: "My library",
		icon: <Icon name="folder" />,
		empty: "No folders yet. Upload a file or create a folder to get started.",
	},
	{
		key: "mounted",
		label: "Mounted",
		icon: <Icon name="projects" />,
		empty: "Project and channel attachments appear here once you join an engagement.",
	},
	{
		key: "drives",
		label: "Connected drives",
		icon: <Icon name="box" />,
		empty: "Connect a drive from the action bar to browse it here.",
	},
];

/**
 * Which section a root node belongs to.
 *
 * Keyed on `nodeKind` (what the node IS) rather than `kind` (how its card is drawn), because the two
 * deliberately differ: a mounted drive root and a project root both shape to the `stage` CARD, and
 * partitioning on that would file a connected Dropbox under Mounted.
 */
function sectionOf(node: AssetTreeNode): SectionKey {
	switch (node.nodeKind) {
		case "project":
		case "channel":
			return "mounted";
		case "drive":
		case "mount":
			return "drives";
		default:
			return "library";
	}
}
// #endregion

// #region Tree adaptation
/** Map one wire node (and its subtree) onto a {@link TreeNavNode}, threading the accumulated path. */
function toNavNode(node: AssetTreeNode, parentPath: string[]): TreeNavNode {
	const path = [...parentPath, node.segment];
	return {
		key: pathKey(path),
		label: node.label,
		sublabel: node.sublabel ?? undefined,
		icon: <NodeMark nodeKind={node.nodeKind} />,
		avatar: node.avatar ? { image: node.avatar, label: node.label } : null,
		count: node.fileCount,
		children: node.children.map((c) => toNavNode(c, path)),
	};
}

/**
 * Narrow a subtree to nodes matching `q`, keeping any ancestor of a match.
 *
 * A branch whose own label misses but whose child hits must survive, or filtering the tree would hide
 * the only route to the thing being searched for. Returns a new array; never mutates the signal's.
 */
function filterTree(nodes: readonly AssetTreeNode[], q: string): AssetTreeNode[] {
	if (!q) return [...nodes];
	const out: AssetTreeNode[] = [];
	for (const node of nodes) {
		const children = filterTree(node.children, q);
		if (node.label.toLowerCase().includes(q) || children.length > 0) {
			out.push({ ...node, children });
		}
	}
	return out;
}

/** Every path key in a subtree — what a search result force-opens so the match is actually visible. */
function allKeys(nodes: readonly AssetTreeNode[], parentPath: string[], into: Set<string>): void {
	for (const node of nodes) {
		const path = [...parentPath, node.segment];
		into.add(pathKey(path));
		allKeys(node.children, path, into);
	}
}
// #endregion

/** The synthetic root row's key — the scope root, addressable like any other node. */
const ROOT_KEY = "__root__";

export default function FilesLane(props: FilesLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const query = useSignal("");
	const expanded = useSignal<Set<string>>(new Set([ROOT_KEY]));
	const openSections = useSignal<Set<SectionKey>>(new Set<SectionKey>(["library", "mounted"]));
	/** A lane-local transport failure. Never blanks the tree it already has (see `load`). */
	const treeError = useSignal<string | null>(null);
	const loadingTree = useSignal(false);

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
		const sim = simFromSeam();
		const res = await FilesService.tree({
			scope: props.scope,
			subjectId: props.subjectId,
			ownerType: props.ownerType,
			ownerId: props.ownerId,
		}, sim);
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
		const q = await FilesService.quota(props.ownerType, props.ownerId, sim);
		if (q.ok && q.data) quota.value = q.data;
	}

	useEffect(() => {
		// Seed the shared location so the body's first commit reads the URL, not a stale scope.
		currentScope.value = props.scope;
		subjectIdSignal.value = props.subjectId;
		currentPath.value = props.segments;

		// Force-open the ancestor chain of the deep-linked folder, so arriving four levels down does not
		// require expanding four rows by hand.
		const next = new Set(expanded.value);
		next.add(ROOT_KEY);
		for (const key of ancestorKeys(props.segments)) next.add(key || ROOT_KEY);
		expanded.value = next;

		try {
			const el = globalThis.document?.querySelector(".ui-splitter") as HTMLElement | null;
			collapsed.value = el?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }

		void load();
		// Every dev axis on this surface changes data the SERVER produced, so a seam change must REFETCH;
		// re-rendering would relabel the same rows and look like the switcher was broken.
		return subscribeFilesSim(() => void load());
	}, []);
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

	/**
	 * Scope the workspace to a tree path, in place.
	 *
	 * The address bar is kept in step with `pushState` so the location stays deep-linkable, copyable and
	 * back-navigable, while `commitFiles` asks the BODY — the single fetch owner — to re-read. The lane
	 * never fetches the listing itself; two regions fetching one query is how they drift.
	 */
	function navigate(segments: string[]): void {
		currentPath.value = segments;
		try {
			globalThis.history?.pushState({}, "", assetHref(props.base, segments));
		} catch { /* SSR / no history — non-fatal */ }
		commitFiles();
	}

	/** A TreeNav key is a `pathKey`: percent-encoded segments joined by `/`, so decode after splitting. */
	function pathOfKey(key: string): string[] {
		if (key === ROOT_KEY || key === "") return [];
		return key.split("/").map((s) => {
			try {
				return decodeURIComponent(s);
			} catch {
				return s;
			}
		});
	}
	// #endregion

	// #region Derived tree
	const q = useComputed(() => query.value.trim().toLowerCase());

	const sectioned = useComputed(() => {
		const filtered = filterTree(tree.value, q.value);
		const buckets: Record<SectionKey, AssetTreeNode[]> = { library: [], mounted: [], drives: [] };
		for (const node of filtered) buckets[sectionOf(node)].push(node);
		return buckets;
	});

	const matches = useComputed(() =>
		sectioned.value.library.length + sectioned.value.mounted.length + sectioned.value.drives.length
	);

	// A search that matched deep in the tree must SHOW its matches, so a live query force-opens every
	// surviving branch. Done in an EFFECT rather than while rendering: writing a signal during render
	// re-enters the same render, and `expanded` is the very signal TreeNav writes back to.
	useEffect(() => {
		if (!q.value) return;
		const open = new Set(expanded.value);
		open.add(ROOT_KEY);
		const b = sectioned.value;
		allKeys([...b.library, ...b.mounted, ...b.drives], [], open);
		// Only ever a widening, so it cannot fight the person's own collapse mid-search.
		if (open.size !== expanded.value.size) expanded.value = open;
	}, [q.value, tree.value]);

	const selectedKey = props.segments.length === 0 ? ROOT_KEY : pathKey(props.segments);

	/** The library section leads with a synthetic root row, so there is always one click back to the top. */
	function nodesFor(key: SectionKey): TreeNavNode[] {
		const nodes = sectioned.value[key].map((n) => toNavNode(n, []));
		if (key !== "library") return nodes;
		return [{
			key: ROOT_KEY,
			label: props.ownerLabel,
			icon: <Icon name="folder" />,
			children: nodes,
		}];
	}
	// #endregion

	/** The top-level library folders the collapsed rail offers as direct jumps. */
	const railFolders = useComputed(() => sectioned.value.library.slice(0, 7));

	return (
		<div class="fh-lanewrap">
			{/* Collapsed presentation — revealed by CSS at the rail density. */}
			<div class="fh-rail">
				<Tooltip content={props.ownerLabel} placement="right">
					<button
						type="button"
						class="fh-rail__item"
						data-active={props.segments.length === 0 ? "true" : undefined}
						aria-label={`${props.ownerLabel} — library root`}
						onClick={() => navigate([])}
					>
						<Icon name="folder" size="md" />
					</button>
				</Tooltip>

				<div class="fh-rail__items" role="list">
					{railFolders.value.map((node) => (
						<Tooltip key={node.segment} content={node.label} placement="right">
							<button
								type="button"
								class="fh-rail__item"
								role="listitem"
								data-active={props.segments[0] === node.segment ? "true" : undefined}
								aria-label={node.label}
								onClick={() =>
									navigate([node.segment])}
							>
								<NodeMark nodeKind={node.nodeKind} />
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
					<Tooltip content="Expand lane" placement="right">
						<button
							type="button"
							class="fh-rail__item"
							aria-label="Expand lane"
							onClick={() => setLaneCollapsed(false)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</div>

			{/* Expanded presentation. */}
			<div class="fh-lane">
				<LaneHead class="fh-lane__head">
					<LaneBar>
						<LaneSearch
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

					{matches.value === 0 && q.value
						? (
							<LaneEmpty
								title="No folder matches"
								note="Try a shorter term, or clear the search."
								icon={<Icon name="folder" />}
							/>
						)
						: (
							<LaneSections>
								{SECTIONS.map((section) => {
									const nodes = nodesFor(section.key);
									const populated = sectioned.value[section.key].length > 0;
									// A section with nothing in it is still shown, closed: its absence would be
									// indistinguishable from a library that has no drives connected, and the
									// empty state is where the reader learns the section exists at all.
									if (!populated && q.value) return null;
									return (
										<LaneSection
											key={section.key}
											id={`files-${section.key}`}
											icon={section.icon}
											label={section.label}
											open={openSections.value.has(section.key)}
											onToggle={() => {
												const next = new Set(openSections.value);
												if (next.has(section.key)) next.delete(section.key);
												else next.add(section.key);
												openSections.value = next;
											}}
										>
											{populated
												? (
													<TreeNav
														nodes={nodes}
														selectedKey={selectedKey}
														expanded={expanded}
														onSelect={(node) => navigate(pathOfKey(node.key))}
														aria-label={section.label}
													/>
												)
												: <p class="fh-lane__sectionempty">{section.empty}</p>}
										</LaneSection>
									);
								})}
							</LaneSections>
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
				</LaneFooter>
			</div>
		</div>
	);
}
