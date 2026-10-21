import { assertEquals } from "@std/assert";
import { AssetTreeNodeSchema } from "@projective/types/files";
import { libraryTree } from "./library-tree.ts";

// #region Fixture
const FOLDERS = [
	{ id: "f-brief", name: "Brief", parent_folder_id: null },
	{ id: "f-drafts", name: "Drafts", parent_folder_id: null },
	{ id: "f-v2", name: "v2", parent_folder_id: "f-drafts" },
];
const ITEMS = [
	{ folder_id: null },
	{ folder_id: "f-brief" },
	{ folder_id: "f-v2" },
	{ folder_id: "f-v2" },
];
// #endregion

Deno.test("libraryTree roots every top-level folder under one labelled root", () => {
	const root = libraryTree({ folders: FOLDERS, items: ITEMS }, "Atelier Nova");
	assertEquals(root.nodeKind, "root");
	assertEquals(root.label, "Atelier Nova");
	assertEquals(root.children.map((n) => n.segment), ["f-brief", "f-drafts"]);
	assertEquals(root.children[1].children.map((n) => n.label), ["v2"]);
});

Deno.test("libraryTree counts a folder's whole subtree, and the root every file", () => {
	const root = libraryTree({ folders: FOLDERS, items: ITEMS }, "Atelier Nova");
	const [brief, drafts] = root.children;
	assertEquals(root.fileCount, 4);
	assertEquals(brief.fileCount, 1);
	assertEquals(drafts.fileCount, 2);
	assertEquals(drafts.children[0].fileCount, 2);
});

Deno.test("libraryTree marks every node read-only for a library that takes nothing new", () => {
	const root = libraryTree({ folders: FOLDERS, items: ITEMS }, "Archived team", true);
	const flat = [root, ...root.children, ...root.children.flatMap((n) => n.children)];
	assertEquals(flat.every((n) => n.readOnly === true), true);
});

Deno.test("libraryTree survives a parent cycle and an unnamed folder", () => {
	const root = libraryTree({
		folders: [
			{ id: "a", name: null, parent_folder_id: null },
			{ id: "b", name: "B", parent_folder_id: "c" },
			{ id: "c", name: "C", parent_folder_id: "b" },
		],
		items: [{ folder_id: "b" }],
	}, "Root");
	assertEquals(root.children.map((n) => n.label), ["Folder"]);
	assertEquals(root.fileCount, 1);
});

Deno.test("libraryTree answers the wire schema", () => {
	const root = libraryTree({ folders: FOLDERS, items: ITEMS }, "Atelier Nova");
	assertEquals(AssetTreeNodeSchema.safeParse(root).success, true);
});
