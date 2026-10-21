import type { AssetFolder, AssetTreeNode } from "../types/file-types.ts";

/**
 * folder-tree — the pure decisions behind a folder panel that sits beside a listing it does not own.
 *
 * Two facts make this necessary. A location's address spells a folder by its id (the server's crumbs)
 * OR by its name (a folder card opened by name), and the server resolves either; the tree keys every
 * node on the id. And the tree is read separately from the listing, so a folder created, renamed,
 * moved or deleted through the listing leaves the tree describing a library that no longer exists.
 * {@link resolveTreePath} answers the first and {@link treeIsStale} detects the second, so the panel
 * re-reads exactly when the listing proves it is out of date and never on a timer.
 */

// #region Model
/** Where a location's segments land in the tree. */
export interface TreePathMatch {
	/** The node segments (folder ids) matched, root-first — the deepest prefix that resolved. */
	path: string[];
	/** Whether every segment resolved; a partial match means the tree is behind the address. */
	complete: boolean;
}

/**
 * Resolve a location's segments against the nodes under the host's root row, matching each by its
 * segment or, case-insensitively, by its label — the server's own tolerant resolution.
 */
export function resolveTreePath(
	roots: readonly AssetTreeNode[],
	segments: readonly string[],
): TreePathMatch {
	const path: string[] = [];
	let nodes: readonly AssetTreeNode[] = roots;
	for (const segment of segments) {
		const lower = segment.toLowerCase();
		const next = nodes.find((n) => n.segment === segment) ??
			nodes.find((n) => n.label.toLowerCase() === lower);
		if (!next) return { path, complete: false };
		path.push(next.segment);
		nodes = next.children;
	}
	return { path, complete: true };
}

/**
 * Whether the tree disagrees with the folders a listing shows at the same location: a location the
 * tree cannot reach, or a child folder set that differs by id or by name. Only meaningful for an
 * UNNARROWED listing — a search also narrows a location's child folders by name.
 */
export function treeIsStale(
	roots: readonly AssetTreeNode[],
	segments: readonly string[],
	folders: readonly Pick<AssetFolder, "id" | "name">[],
): boolean {
	const match = resolveTreePath(roots, segments);
	if (!match.complete) return true;
	let children: readonly AssetTreeNode[] = roots;
	for (const segment of match.path) {
		children = children.find((n) => n.segment === segment)?.children ?? [];
	}
	if (children.length !== folders.length) return true;
	const named = new Map(children.map((n) => [n.folderId ?? n.segment, n.label]));
	return folders.some((f) => named.get(f.id) !== f.name);
}
// #endregion
