import {
	type AssetCrumb,
	type AssetFolder,
	type AssetItem,
	type AssetSource,
	type AssetTreeNode,
	type FileScope,
	type FileSortDir,
	type FileSortKey,
	folderHref,
	SHARE_ROUTE_BASE,
	sourceLabel,
} from "../types/file-types.ts";

/**
 * asset-model — the PURE helper layer for the `/files` asset hub.
 *
 * Everything here is a total function of its arguments: no signals, no `fetch`, no `Date.now()`, no
 * DOM. That is what lets the same call produce the same answer during SSR and after a client refetch,
 * which is the property the hub's deep links, breadcrumbs and sort order all depend on.
 *
 * The path primitives ({@link pathKey}, {@link ancestorKeys}) are **re-exported from the Zod SSOT**
 * rather than reimplemented — they are the encoding contract a folder id, a URL and an expansion key
 * all have to agree on, and two implementations of an encoding is one more than can ever be kept in
 * step.
 */

// #region Path primitives (re-exported from the SSOT — never reimplemented)
export { ancestorKeys, folderHref, pathKey } from "../types/file-types.ts";
// #endregion

// #region Routing
/**
 * The deep-link URL for a tree path under a scope base.
 *
 * The hub's name for the SSOT's {@link folderHref}, which it delegates to verbatim — a folder path and
 * an asset path are the same URL in this model (an asset is addressed by its folder plus its id in the
 * preview modal, never by a path of its own), so this is an alias for readability at the call site and
 * deliberately not a second encoder.
 */
export function assetHref(base: string, segments: readonly string[]): string {
	return folderHref(base, segments);
}

/** Where a scope's file surface lives — the base every {@link assetHref} in that scope is built on. */
export function filesHref(
	scope: FileScope,
	opts?: { subjectId?: string | null; channelId?: string | null },
): string {
	const subject = opts?.subjectId ?? "";
	const channel = opts?.channelId ?? "";
	switch (scope) {
		case "hub":
			return "/files";
		case "drive":
			return subject ? `/files/drives/${encodeURIComponent(subject)}` : "/files";
		case "project":
			return subject ? `/projects/${encodeURIComponent(subject)}/files` : "/files";
		case "channel":
			return subject && channel
				? `/projects/${encodeURIComponent(subject)}/${encodeURIComponent(channel)}/files`
				: subject
				? `/projects/${encodeURIComponent(subject)}/files`
				: "/files";
		case "conversation":
			return subject ? `/messages/${encodeURIComponent(subject)}/files` : "/messages";
		case "share":
			return subject ? `${SHARE_ROUTE_BASE}/${encodeURIComponent(subject)}` : SHARE_ROUTE_BASE;
	}
}

/** Human label for a space — the breadcrumb root and the picker's source tabs. */
export function scopeLabel(scope: FileScope): string {
	switch (scope) {
		case "hub":
			return "My files";
		case "drive":
			return "Connected drive";
		case "project":
			return "Project files";
		case "channel":
			return "Channel files";
		case "conversation":
			return "Conversation files";
		case "share":
			return "Shared with you";
	}
}
// #endregion

// #region Tree navigation
/**
 * Resolve the tree node addressed by `segments` (a chain from the scope root).
 *
 * Returns `null` for the scope root (`[]`) and degrades to the DEEPEST matched node when a segment is
 * unknown, mirroring the server's tolerant path resolution — a stale deep link should land somewhere
 * sensible rather than emptying the workspace. Identical in behaviour to the submissions explorer's
 * resolver, because the two navigate the same node shape.
 */
export function nodeAt(
	tree: readonly AssetTreeNode[],
	segments: readonly string[],
): AssetTreeNode | null {
	let nodes: readonly AssetTreeNode[] = tree;
	let found: AssetTreeNode | null = null;
	for (const seg of segments) {
		const next = nodes.find((n) => n.segment === seg);
		if (!next) return found;
		found = next;
		nodes = next.children;
	}
	return found;
}

/** The direct child nodes of the node at `segments` (or the roots at the scope root). */
export function childNodesAt(
	tree: readonly AssetTreeNode[],
	segments: readonly string[],
): AssetTreeNode[] {
	const node = nodeAt(tree, segments);
	return node ? node.children : [...tree];
}

/**
 * The breadcrumb trail to a path.
 *
 * Labels come from the tree when one is supplied, so a crumb reads the folder's real name rather than
 * its URL segment; without a tree the segment is decoded and used, which is the honest fallback for a
 * deep link that arrived before the tree did (SSR's first byte, or a share resolution).
 *
 * The root crumb is always present and always addresses `base` — a person who has drilled four levels
 * needs one click back to the top, and a trail that starts at level one cannot give them that.
 */
export function breadcrumbsFor(
	path: readonly string[],
	opts?: {
		/** The scope base the crumbs link under; defaults to the hub. */
		base?: string;
		/** Label for the root crumb; defaults to the hub's. */
		rootLabel?: string;
		/** The navigation tree, when available — turns segments into real folder names. */
		tree?: readonly AssetTreeNode[];
	},
): AssetCrumb[] {
	const base = opts?.base ?? "/files";
	const tree = opts?.tree;
	const crumbs: AssetCrumb[] = [
		{ id: null, label: opts?.rootLabel ?? scopeLabel("hub"), href: base },
	];
	for (let i = 0; i < path.length; i++) {
		const prefix = path.slice(0, i + 1);
		const node = tree ? nodeAt(tree, prefix) : null;
		crumbs.push({
			id: node?.folderId ?? null,
			label: node?.label ?? safeDecode(path[i]),
			href: assetHref(base, prefix),
		});
	}
	return crumbs;
}

/** Percent-decode a segment, returning it unchanged when it is not valid encoding. */
function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
// #endregion

// #region Folder → tree node (the SubmissionCard reuse seam)
/**
 * Shape an {@link AssetFolder} into the {@link AssetTreeNode} the shared submissions components read.
 *
 * This function is the seam that lets `/files` mount `SubmissionCard`, `SubmissionTree` and
 * `SubmissionNodeList` VERBATIM instead of forking a second folder-card family: those components read
 * `kind` / `label` / `sublabel` / `status` / `fileCount` / `children` off a `SubmissionTreeNode`, and
 * an `AssetTreeNode` carrying compatible values for all of them is assignable to one.
 *
 * Two mappings are deliberate rather than mechanical:
 *
 *  - **`segment` is the folder NAME, not its id.** `AssetFolder.path` is the materialised chain of
 *    ancestor NAMES, so a name is what a URL segment has to be for `folder.path` and the address bar
 *    to agree. `pathKey` percent-encodes each segment before joining, so a folder named `a/b` still
 *    cannot masquerade as the nested pair `["a", "b"]`.
 *  - **A mounted root shapes to `stage`, everything else to `dir`** — the SSOT's card-treatment
 *    mapping. A connected drive is a container of a different order from a folder inside it, and the
 *    submissions card family already draws exactly that distinction.
 *
 * `status` is never set: a review status is a submissions concept and a folder has no equivalent, so
 * the card falls back to its `sublabel`. Inventing one would put a review verdict on a directory.
 */
export function shapeFolderAsNode(
	folder: AssetFolder,
	children: AssetTreeNode[] = [],
): AssetTreeNode {
	const mounted = folder.source !== "supabase";
	const isMountRoot = mounted && folder.parentId === null;
	return {
		segment: folder.name,
		kind: isMountRoot ? "stage" : "dir",
		nodeKind: mounted ? (isMountRoot ? "drive" : "mount") : "folder",
		label: folder.name,
		sublabel: mounted ? sourceLabel(folder.source) : null,
		avatar: null,
		handle: null,
		folderId: folder.id,
		readOnly: mounted,
		fileCount: folder.itemCount,
		children,
	};
}
// #endregion

// #region Source glyphs
/**
 * The glyph key for an asset's storage source.
 *
 * `link` resolves to the shared `@projective/ui/icons` registry key of the same name; the four
 * connector keys are BRAND marks, which §B.7 quarantines out of the shared registry (a brand mark is
 * not an icon in the design system's sense — it cannot be restyled, recoloured or re-weighted), so
 * the feature's own glyph module owns those four. Returning a typed key rather than a component keeps
 * this module pure and SSR-safe.
 */
export type AssetSourceGlyph =
	| "library"
	| "google-drive"
	| "dropbox"
	| "frameio"
	| "amazon-s3"
	| "link";

/** Map a storage source onto its glyph key. */
export function sourceGlyphKey(source: AssetSource): AssetSourceGlyph {
	switch (source) {
		case "supabase":
			return "library";
		case "google_drive":
			return "google-drive";
		case "dropbox":
			return "dropbox";
		case "frameio":
			return "frameio";
		case "s3":
			return "amazon-s3";
		case "link":
			return "link";
	}
}
// #endregion

// #region Sorting
/** Compare two ISO timestamps, tolerating an unparseable one by falling back to a string compare. */
function compareIso(a: string, b: string): number {
	const ta = Date.parse(a);
	const tb = Date.parse(b);
	if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Case- and accent-insensitive name compare, with digit runs ordered numerically (`img2` < `img10`). */
function compareName(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The ASCENDING comparator for each sortable property. Direction is applied by the caller
 * ({@link sortAssets}), so a comparator is never written twice with its operands swapped.
 *
 * `sender` falls back to the SOURCE label when an asset has no sender, because a hub-uploaded or
 * drive-mounted asset was posted by nobody — sorting those into one undifferentiated block at the end
 * would hide the one thing that actually distinguishes them.
 */
export const sortComparators: Record<FileSortKey, (a: AssetItem, b: AssetItem) => number> = {
	name: (a, b) => compareName(a.name, b.name),
	date: (a, b) => compareIso(a.createdAt, b.createdAt) || compareName(a.name, b.name),
	size: (a, b) => a.sizeBytes - b.sizeBytes || compareName(a.name, b.name),
	sender: (a, b) =>
		compareName(a.sender?.name ?? sourceLabel(a.source), b.sender?.name ?? sourceLabel(b.source)) ||
		compareName(a.name, b.name),
	// An extension is what the "type" column shows, so it is what "type" sorts on. Links carry no
	// extension and are grouped at the end rather than ahead of every named type.
	type: (a, b) => {
		const ea = a.ext || "￿";
		const eb = b.ext || "￿";
		return compareName(ea, eb) || compareName(a.name, b.name);
	},
};

/** The ascending comparator for each sortable folder property (folders have no sender and no type). */
export const folderComparators: Record<FileSortKey, (a: AssetFolder, b: AssetFolder) => number> = {
	name: (a, b) => compareName(a.name, b.name),
	date: (a, b) => compareIso(a.createdAt, b.createdAt) || compareName(a.name, b.name),
	size: (a, b) => a.sizeBytes - b.sizeBytes || compareName(a.name, b.name),
	sender: (a, b) => compareName(a.name, b.name),
	type: (a, b) => compareName(a.name, b.name),
};

/** A sorted COPY of the assets (never sorted in place — the input may be a signal's current array). */
export function sortAssets(
	items: readonly AssetItem[],
	key: FileSortKey,
	dir: FileSortDir,
): AssetItem[] {
	const cmp = sortComparators[key];
	const sign = dir === "desc" ? -1 : 1;
	return [...items].sort((a, b) => sign * cmp(a, b));
}

/** A sorted COPY of the folders, using the same key/direction as the assets beside them. */
export function sortFolders(
	folders: readonly AssetFolder[],
	key: FileSortKey,
	dir: FileSortDir,
): AssetFolder[] {
	const cmp = folderComparators[key];
	const sign = dir === "desc" ? -1 : 1;
	return [...folders].sort((a, b) => sign * cmp(a, b));
}
// #endregion
