import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { TreeNav, type TreeNavNode } from "@projective/ui/navigation";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/files-hub.css";
import { pathKey } from "../core/asset-model.ts";
import type { AssetTreeNode } from "../types/file-types.ts";
import { NodeMark } from "./file-hub-glyphs.tsx";

/**
 * AssetTree — the `/files` navigation tree: the library's own folders, the mounted engagements, and
 * the connected drives, in one hierarchy.
 *
 * Like every other folder affordance in the hub this REUSES rather than re-draws: it maps
 * {@link AssetTreeNode} onto the shared `@projective/ui/navigation` {@link TreeNav}, exactly as the
 * Submissions explorer's `SubmissionTree` does. That is not only tidiness — `TreeNav` implements the
 * APG tree pattern (one tab stop, roving focus, Arrow/Home/End, `role="tree"`/`treeitem` with
 * `aria-level`/`aria-expanded`/`aria-selected`), and a second tree would be a second, weaker
 * implementation of all of it.
 *
 * ## Three deliberate mappings
 *
 * **A node's key is its `pathKey`.** Expansion state, selection and a deep link all have to agree on
 * one identifier, and the path — not the folder id — is the thing the URL, the breadcrumbs and the
 * server's tolerant path resolution are written in. A synthetic root (`ROOT_KEY`) addresses the scope
 * root, so "back to the top" is one click from six levels down.
 *
 * **`onNavigate` receives DECODED segments.** `pathKey` percent-encodes each segment before joining,
 * so splitting a key yields encoded text; every consumer of a path in this feature (the server's
 * `path` param, `breadcrumbsFor`, `segmentsOfCrumb`) works in real names. Decoding here means a folder
 * literally named `a/b` survives the round trip as one segment instead of arriving as the nested pair
 * `["a", "b"]`.
 *
 * **A read-only mount is marked, not disabled.** A mounted channel or a connected drive is browsable
 * and attachable; it simply cannot be written to. Disabling the row would make the files inside it
 * unreachable, so the row stays live and carries a lock in the trailing status slot — an in-row
 * ICONOGRAPHIC state whose words live in the hover tooltip (§B.6), never as inline text.
 *
 * ## Drop targets
 *
 * The tree is a natural destination for a dragged selection, but a `TreeNav` row exposes no per-row
 * hook and `@projective/ui/dnd` requires the drag source and the target to share ONE `DndContext` —
 * which a lane and a body, being separate hydration roots, cannot. So this component deliberately
 * does not pretend to own drop targets: a host that wants them wraps the tree (or a region of it) in
 * its own `Droppable` and reads the dragged selection from `files-state`. {@link assetTreeTargets}
 * gives that host the addressable nodes without it having to walk the tree itself.
 *
 * Dumb: no data access, no fetching. The expansion set is the HOST's signal, so a deep link can
 * force-open the target's ancestor chain (`ancestorKeys`).
 */

// #region Props
export interface AssetTreeProps {
	/** The scope's navigation tree, as the server resolved it. */
	tree: AssetTreeNode[];
	/** Label for the synthetic root node ("My files", an entity's vault name). */
	rootLabel: string;
	/** Total assets under the whole tree — the root row's muted count. */
	rootCount: number;
	/** The path currently in view; `[]` selects the root. */
	currentPath: string[];
	/** Controlled expanded-key set (`pathKey`s, plus {@link ROOT_KEY}) — owned by the host. */
	expanded: Signal<Set<string>>;
	/** Navigate to a path, in place. Receives DECODED segments (see the module note). */
	onNavigate: (path: string[]) => void;
	/** Accessible name for the tree. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/** The synthetic root node's key — the scope root, whose real path is `[]`. */
export const ROOT_KEY = "__files_root__";

// #region Model
/** Percent-decode one path segment, returning it unchanged when it is not valid encoding. */
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * The trailing status slot: a lock on a read-only mount, nothing otherwise.
 *
 * The tooltip is the only place the word appears — an in-row state is a glyph, and the sentence
 * explaining it belongs on hover (§B.6). `aria-label` on the wrapper carries the same fact to a
 * screen reader, which cannot hover.
 */
function statusMark(node: AssetTreeNode): JSX.Element | null {
	if (!node.readOnly) return null;
	return (
		<Tooltip content="Read-only — you can browse and attach, but not change what is here">
			<span class="fh-tree__lock" aria-label="Read-only">
				<Icon name="lock" size="2xs" />
			</span>
		</Tooltip>
	);
}

/** Map one node (and its subtree) onto a {@link TreeNavNode}, threading the accumulated path. */
function toNavNode(node: AssetTreeNode, parentPath: string[]): TreeNavNode {
	const path = [...parentPath, node.segment];
	return {
		key: pathKey(path),
		label: node.label,
		sublabel: node.sublabel ?? undefined,
		icon: <NodeMark nodeKind={node.nodeKind} />,
		// A person- or entity-scoped node carries its picture; everything else takes the kind glyph.
		avatar: node.avatar ? { image: node.avatar, label: node.label } : null,
		status: statusMark(node),
		count: node.fileCount,
		children: node.children.map((child) => toNavNode(child, path)),
	};
}

/** One addressable destination in the tree — what a host needs to build a drop target per node. */
export interface AssetTreeTarget {
	/** The node's `pathKey` — the same identifier the tree selects and expands on. */
	key: string;
	/** The decoded path segments the node addresses. */
	path: string[];
	/** The folder a drop would land in, or `null` for a synthetic grouping node. */
	folderId: string | null;
	label: string;
	/** Whether the node refuses writes — a drop here must not be offered. */
	readOnly: boolean;
}

/**
 * Flatten the tree into its addressable destinations, depth-first in render order.
 *
 * Exposed so a host that owns a `DndContext` can register a drop target per node without walking the
 * recursive shape itself — and so that "which nodes accept a drop" is answered in one place rather
 * than re-derived, slightly differently, by every caller.
 */
export function assetTreeTargets(
	tree: readonly AssetTreeNode[],
	parentPath: string[] = [],
): AssetTreeTarget[] {
	const out: AssetTreeTarget[] = [];
	for (const node of tree) {
		const path = [...parentPath, node.segment];
		out.push({
			key: pathKey(path),
			path,
			folderId: node.folderId ?? null,
			label: node.label,
			readOnly: node.readOnly === true,
		});
		out.push(...assetTreeTargets(node.children, path));
	}
	return out;
}
// #endregion

export function AssetTree(props: AssetTreeProps): JSX.Element {
	const { tree, rootLabel, rootCount, currentPath, expanded, onNavigate } = props;

	const rootNode: TreeNavNode = {
		key: ROOT_KEY,
		label: rootLabel,
		icon: <NodeMark nodeKind="root" />,
		count: rootCount,
		children: tree.map((node) => toNavNode(node, [])),
	};

	const selectedKey = currentPath.length === 0 ? ROOT_KEY : pathKey(currentPath);

	function handleSelect(node: TreeNavNode): void {
		if (node.key === ROOT_KEY) {
			onNavigate([]);
			return;
		}
		onNavigate(node.key.split("/").map(decodeSegment));
	}

	return (
		<div class={`fh-tree${props.class ? ` ${props.class}` : ""}`}>
			<TreeNav
				nodes={[rootNode]}
				selectedKey={selectedKey}
				expanded={expanded}
				onSelect={handleSelect}
				aria-label={props["aria-label"] ?? "Files"}
			/>
		</div>
	);
}
