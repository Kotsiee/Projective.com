import {
	type AssetNodeKind,
	type AssetTreeNode,
	driveAddressOf,
	isMountPath,
	pathKey,
} from "../types/file-types.ts";
import { resolveTreePath } from "./folder-tree.ts";
import { nodePath } from "./asset-model.ts";

/**
 * files-tree — the pure model behind the `/files` lane's one tree: the three roots, the nested rows
 * beneath them, the row a location selects and the menu each row offers.
 *
 * The server's tree is flat at the top (the library root, each project, each drive), and a project's or
 * a drive's own children arrive only when that row is opened. This folds both into one hierarchy keyed
 * on the hub path, so a row, the address bar and the expansion set agree on one identifier.
 */

/** The Library row: the library root, addressable like any folder. */
export const LIBRARY_KEY = "__library__";

/** The Projects heading. A grouping with no location of its own. */
export const PROJECTS_KEY = "__projects__";

/** The Connected Drives heading. A grouping with no location of its own. */
export const DRIVES_KEY = "__drives__";

/** The children read so far, by the `pathKey` of the node they sit under. */
export type LoadedChildren = Readonly<Record<string, readonly AssetTreeNode[]>>;

/** One row of the lane's tree. */
export interface LaneNode {
	key: string;
	label: string;
	sublabel: string | null;
	nodeKind: AssetNodeKind | "group";
	avatar: string | null;
	/** The hub path it opens; `null` for a heading. */
	path: string[] | null;
	/** The library folder it is, or `null`. Only these and the root take writes. */
	folderId: string | null;
	/** The connected drive it is the root of, or `null`. */
	connectionId: string | null;
	/** The folder's colour, or `null` for the default. */
	color: string | null;
	readOnly: boolean;
	fileCount: number | null;
	/** Whether opening it reads children that have not arrived. */
	lazy: boolean;
	children: LaneNode[];
}

function groupNode(key: string, label: string, children: LaneNode[]): LaneNode {
	return {
		key,
		label,
		sublabel: null,
		nodeKind: "group",
		avatar: null,
		path: null,
		folderId: null,
		connectionId: null,
		color: null,
		readOnly: true,
		fileCount: null,
		lazy: false,
		children,
	};
}

function laneNode(node: AssetTreeNode, path: string[], loaded: LoadedChildren): LaneNode {
	const key = pathKey(path);
	const mounted = node.nodeKind !== "folder";
	const arrived = loaded[key];
	return {
		key,
		label: node.label,
		sublabel: node.sublabel ?? null,
		nodeKind: node.nodeKind,
		avatar: node.avatar ?? null,
		path,
		folderId: mounted ? null : node.folderId ?? null,
		connectionId: node.nodeKind === "drive" ? node.segment : null,
		color: node.color ?? null,
		readOnly: node.readOnly === true,
		// A connector row has no count to show, where a library folder's 0 is a fact.
		fileCount: mounted && node.fileCount === 0 ? null : node.fileCount,
		lazy: mounted && arrived === undefined && node.children.length === 0,
		children: (arrived ?? node.children).map((child) =>
			laneNode(child, [...path, child.segment], loaded)
		),
	};
}

/**
 * The lane's three roots. Each is always present: a Connected Drives row with nothing beneath it is
 * where a person right-clicks to connect one.
 */
export function laneTree(tree: readonly AssetTreeNode[], loaded: LoadedChildren): LaneNode[] {
	const root = tree.find((node) => node.nodeKind === "root");
	const others = tree.filter((node) => node.nodeKind !== "root");
	const rows = (kinds: readonly AssetNodeKind[]) =>
		others.filter((node) => kinds.includes(node.nodeKind))
			.map((node) => laneNode(node, nodePath(node), loaded));
	return [
		{
			...groupNode(
				LIBRARY_KEY,
				"Library",
				(root?.children ?? []).map((node) => laneNode(node, [node.segment], loaded)),
			),
			nodeKind: "root",
			path: [],
			readOnly: root?.readOnly === true,
			fileCount: root?.fileCount ?? null,
		},
		groupNode(PROJECTS_KEY, "Projects", rows(["project", "channel"])),
		groupNode(DRIVES_KEY, "Connected Drives", rows(["drive"])),
	];
}

/** A location as the tree keys it: the library's address may spell a folder by name, the tree by id. */
export function treePath(tree: readonly AssetTreeNode[], path: readonly string[]): string[] {
	if (driveAddressOf(path) || isMountPath(path)) return [...path];
	const library = tree.find((node) => node.nodeKind === "root")?.children ?? [];
	return resolveTreePath(library, path).path;
}

/** The key of the row a location selects. */
export function selectedRow(tree: readonly AssetTreeNode[], path: readonly string[]): string {
	const at = treePath(tree, path);
	return at.length > 0 ? pathKey(at) : LIBRARY_KEY;
}

/** The keys that must be open for the row at `path` (a {@link treePath}) to show. */
export function openChain(path: readonly string[]): string[] {
	const start = driveAddressOf(path) ? 2 : 1;
	const keys: string[] = [];
	for (let end = start; end < path.length; end++) keys.push(pathKey(path.slice(0, end)));
	return keys;
}

/** The lazy prefixes of a location, shallowest first: what a deep link must read to show its row. */
export function lazyPrefixes(path: readonly string[]): string[][] {
	if (isMountPath(path)) return [path.slice(0, 1)];
	if (!driveAddressOf(path)) return [];
	const prefixes: string[][] = [];
	for (let end = 2; end <= path.length; end++) prefixes.push(path.slice(0, end));
	return prefixes;
}

/** Narrow the rows to labels containing `needle`, keeping every ancestor of a match. */
export function filterRows(rows: readonly LaneNode[], needle: string): LaneNode[] {
	if (!needle) return [...rows];
	return rows.flatMap((row) => {
		const children = filterRows(row.children, needle);
		return row.label.toLowerCase().includes(needle) || children.length > 0
			? [{ ...row, children }]
			: [];
	});
}

/** Every key in a set of rows: what a live search force-opens so its matches are visible. */
export function allRowKeys(rows: readonly LaneNode[]): string[] {
	return rows.flatMap((row) => [row.key, ...allRowKeys(row.children)]);
}

/** What a row's right-click can do. */
export type RowAction =
	| "new-folder"
	| "folder-color"
	| "delete-folder"
	| "connect-drive"
	| "disconnect-drive";

/**
 * The actions a row offers. A project and a drive's inner folders offer none: a mounted location is
 * read-only (`SYSTEM_ARCHITECTURE.md`), so its row keeps the browser's own menu.
 */
export function rowActionsOf(row: LaneNode): RowAction[] {
	if (row.key === DRIVES_KEY) return ["connect-drive"];
	if (row.connectionId) return ["connect-drive", "disconnect-drive"];
	if (row.readOnly) return [];
	if (row.key === LIBRARY_KEY) return ["new-folder"];
	return row.folderId ? ["new-folder", "folder-color", "delete-folder"] : [];
}
