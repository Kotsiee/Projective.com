import type { AssetTreeNode } from "@projective/types/files";
import { clamp } from "../../core/text.ts";
import type { FolderRow, ItemRow } from "./asset-row.ts";

/**
 * library-tree — one library's folders as a navigation tree, shared by the `/files` hub's tree (the
 * acting library's section) and a team's or business's drive (the Files module's folder panel).
 *
 * Pure over rows already read under the caller's session: a root carrying every live folder beneath
 * it, keyed on the folder id (the segment a crumb and a tree selection address), each folder counting
 * the files in its whole subtree. The ancestor walk is bounded, so a corrupt parent cycle cannot hang
 * a read (the database refuses one too, `fn_folder_in_library`).
 */

/** The deepest folder chain a count walks before giving up. */
const MAX_DEPTH = 32;

/** The folder fields a subtree write reasons over. */
type FolderShape = Pick<FolderRow, "id" | "name" | "parent_folder_id" | "path">;

/**
 * A folder and everything beneath it, parent-first: the order a move has to write in, because the
 * database checks each row's `path` against its parent's. A corrupt parent cycle ends the walk.
 */
export function subtreeOf(folders: readonly FolderShape[], folderId: string): string[] {
	const seen = new Set([folderId]);
	const order = [folderId];
	for (const id of order) {
		for (const child of folders) {
			if (child.parent_folder_id !== id || seen.has(child.id)) continue;
			seen.add(child.id);
			order.push(child.id);
		}
	}
	return order;
}

/**
 * `name`, or the first free "name (copy)" among `taken` (lower-cased), so a paste beside the original
 * can be told from it. A file keeps its extension last; a folder's name has none, and two siblings may
 * not share one because a folder is addressed by its name.
 */
export function copyName(name: string, taken: ReadonlySet<string>, isFile: boolean): string {
	if (!taken.has(name.toLowerCase())) return name;
	const ext = isFile ? /\.[a-z0-9]{1,12}$/i.exec(name)?.[0] ?? "" : "";
	const stem = ext ? name.slice(0, -ext.length) : name;
	for (let n = 1;; n++) {
		const next = `${stem} (copy${n > 1 ? ` ${n}` : ""})${ext}`;
		if (!taken.has(next.toLowerCase())) return next;
	}
}

/** One row a folder move rewrites. Only the moved folder itself changes parent. */
export interface MovedFolder {
	id: string;
	patch: { parent_folder_id?: string | null; path: string[] };
}

/**
 * What moving `folderId` under `target` (`null` for the library root) writes, parent-first: a folder's
 * `path` is its ancestors' names, so every folder beneath the moved one changes too.
 */
export function movedSubtree(
	folders: readonly FolderShape[],
	folderId: string,
	target: Pick<FolderShape, "id" | "name" | "path"> | null,
): MovedFolder[] {
	const byId = new Map(folders.map((f) => [f.id, f]));
	const paths = new Map<string, string[]>();
	return subtreeOf(folders, folderId).flatMap((id) => {
		const folder = byId.get(id);
		if (!folder) return [];
		const parent = id === folderId ? null : byId.get(folder.parent_folder_id ?? "");
		const path = id === folderId
			? (target ? [...(target.path ?? []), target.name ?? ""] : [])
			: [...(paths.get(parent?.id ?? "") ?? []), parent?.name ?? ""];
		paths.set(id, path);
		return [{
			id,
			patch: id === folderId ? { parent_folder_id: target?.id ?? null, path } : { path },
		}];
	});
}

/**
 * One library as a tree. `readOnly` marks every node, for a library that takes nothing new (an
 * archived entity's drive).
 */
export function libraryTree(
	lib: {
		folders:
			readonly (Pick<FolderRow, "id" | "name" | "parent_folder_id"> & { color?: string | null })[];
		items: readonly Pick<ItemRow, "folder_id">[];
	},
	rootLabel: string,
	readOnly = false,
): AssetTreeNode {
	const counts = new Map<string, number>();
	for (const f of lib.folders) counts.set(f.id, 0);
	const parent = new Map(lib.folders.map((f) => [f.id, f.parent_folder_id]));
	for (const it of lib.items) {
		let cursor: string | null | undefined = it.folder_id;
		let guard = 0;
		while (cursor && guard++ < MAX_DEPTH) {
			counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
			cursor = parent.get(cursor);
		}
	}
	const node = (f: (typeof lib.folders)[number]): AssetTreeNode => ({
		segment: f.id,
		kind: "dir",
		nodeKind: "folder",
		label: clamp(f.name, 200) || "Folder",
		sublabel: null,
		folderId: f.id,
		color: f.color ?? null,
		readOnly,
		fileCount: counts.get(f.id) ?? 0,
		children: lib.folders.filter((c) => c.parent_folder_id === f.id).map(node),
	});
	return {
		segment: "root",
		kind: "stage",
		nodeKind: "root",
		label: rootLabel,
		sublabel: null,
		folderId: null,
		readOnly,
		fileCount: lib.items.length,
		children: lib.folders.filter((f) => f.parent_folder_id === null).map(node),
	};
}
