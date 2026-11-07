/**
 * archive-tree — an archive's flat member list as a folder tree, and the rows a virtual list draws
 * from it. Pure, so the listing of a 200,000-member archive is a few arrays rather than a DOM.
 */

// #region Contract
/** A member as a listing reports it, from a ZIP directory or a tar walk. */
export interface ArchiveMember {
	path: string;
	directory: boolean;
	size: number;
	modified: string | null;
	/** Set for a ZIP entry; a tar's payload is compressed as a whole. */
	packedSize?: number;
	encrypted?: boolean;
}

/** One file or folder of the tree. A folder's size is the sum of what it holds. */
export interface ArchiveNode {
	name: string;
	path: string;
	directory: boolean;
	size: number;
	modified: string | null;
	encrypted: boolean;
	/** Files beneath this folder at any depth; 0 for a file. */
	fileCount: number;
	children: ArchiveNode[];
}

/** A visible row of the tree. */
export interface ArchiveRow {
	node: ArchiveNode;
	depth: number;
}

/** What a listing adds up to. */
export interface ArchiveTotals {
	files: number;
	folders: number;
	size: number;
	packedSize: number | null;
}
// #endregion

// #region Tree
function node(name: string, path: string, directory: boolean): ArchiveNode {
	return {
		name,
		path,
		directory,
		size: 0,
		modified: null,
		encrypted: false,
		fileCount: 0,
		children: [],
	};
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareNodes(a: ArchiveNode, b: ArchiveNode): number {
	if (a.directory !== b.directory) return a.directory ? -1 : 1;
	return COLLATOR.compare(a.name, b.name);
}

function settle(folder: ArchiveNode): void {
	folder.children.sort(compareNodes);
	for (const child of folder.children) {
		if (child.directory) settle(child);
		folder.size += child.size;
		folder.fileCount += child.directory ? child.fileCount : 1;
	}
}

/** Build the tree. Folders a listing never named are created from their members' paths. */
export function buildArchiveTree(members: readonly ArchiveMember[]): ArchiveNode {
	const root = node("", "", true);
	const folders = new Map<string, ArchiveNode>([["", root]]);

	const folderAt = (path: string): ArchiveNode => {
		const known = folders.get(path);
		if (known) return known;
		const slash = path.lastIndexOf("/");
		const parent = folderAt(slash < 0 ? "" : path.slice(0, slash));
		const made = node(path.slice(slash + 1), path, true);
		parent.children.push(made);
		folders.set(path, made);
		return made;
	};

	for (const member of members) {
		const path = member.path.replace(/\/+$/, "");
		if (path.length === 0) continue;
		if (member.directory) {
			folderAt(path).modified = member.modified;
			continue;
		}
		const slash = path.lastIndexOf("/");
		const file = node(path.slice(slash + 1), path, false);
		file.size = member.size;
		file.modified = member.modified;
		file.encrypted = member.encrypted === true;
		folderAt(slash < 0 ? "" : path.slice(0, slash)).children.push(file);
	}
	settle(root);
	return root;
}

/** The rows on show: every child of the root, and the children of each expanded folder. */
export function archiveRows(root: ArchiveNode, expanded: ReadonlySet<string>): ArchiveRow[] {
	const rows: ArchiveRow[] = [];
	const walk = (folder: ArchiveNode, depth: number): void => {
		for (const child of folder.children) {
			rows.push({ node: child, depth });
			if (child.directory && expanded.has(child.path)) walk(child, depth + 1);
		}
	};
	walk(root, 0);
	return rows;
}

/** The folders that open by themselves: a lone top folder, the usual shape of a release archive. */
export function initialExpansion(root: ArchiveNode): Set<string> {
	const open = new Set<string>();
	let folder = root;
	while (folder.children.length === 1 && folder.children[0].directory) {
		folder = folder.children[0];
		open.add(folder.path);
	}
	return open;
}

/** Add a listing up. `packedSize` is null when the format has no per-member figure. */
export function archiveTotals(members: readonly ArchiveMember[]): ArchiveTotals {
	const totals: ArchiveTotals = { files: 0, folders: 0, size: 0, packedSize: null };
	let packed = 0;
	let known = false;
	for (const member of members) {
		if (member.directory) {
			totals.folders += 1;
			continue;
		}
		totals.files += 1;
		totals.size += member.size;
		if (member.packedSize !== undefined) {
			known = true;
			packed += member.packedSize;
		}
	}
	totals.packedSize = known ? packed : null;
	return totals;
}
// #endregion
