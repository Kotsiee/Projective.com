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

/**
 * One library as a tree. `readOnly` marks every node, for a library that takes nothing new (an
 * archived entity's drive).
 */
export function libraryTree(
	lib: {
		folders: readonly Pick<FolderRow, "id" | "name" | "parent_folder_id">[];
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
	const node = (f: Pick<FolderRow, "id" | "name" | "parent_folder_id">): AssetTreeNode => ({
		segment: f.id,
		kind: "dir",
		nodeKind: "folder",
		label: clamp(f.name, 200) || "Folder",
		sublabel: null,
		folderId: f.id,
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
