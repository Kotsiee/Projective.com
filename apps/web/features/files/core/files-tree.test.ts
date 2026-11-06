import { assertEquals } from "@std/assert";
import type { AssetTreeNode } from "../types/file-types.ts";
import {
	DRIVES_KEY,
	filterRows,
	laneTree,
	lazyPrefixes,
	LIBRARY_KEY,
	openChain,
	PROJECTS_KEY,
	rowActionsOf,
	selectedRow,
} from "./files-tree.ts";

const CONNECTION = "c0a8012e-0000-4000-8000-000000000001";

function node(over: Partial<AssetTreeNode> & { segment: string }): AssetTreeNode {
	return {
		kind: "dir",
		nodeKind: "folder",
		label: over.segment,
		sublabel: null,
		folderId: over.segment,
		readOnly: false,
		fileCount: 0,
		children: [],
		...over,
	};
}

const TREE: AssetTreeNode[] = [
	node({
		segment: "root",
		kind: "stage",
		nodeKind: "root",
		label: "Library",
		folderId: null,
		fileCount: 3,
		children: [node({
			segment: "f1",
			label: "Brand",
			children: [node({ segment: "f2", label: "Logos", fileCount: 2 })],
		})],
	}),
	node({
		segment: "mnt-prj-a",
		nodeKind: "project",
		label: "Rebrand",
		readOnly: true,
		fileCount: 4,
	}),
	node({ segment: CONNECTION, nodeKind: "drive", label: "Google", readOnly: true }),
];

Deno.test("the three roots hold their own populations, whatever exists", () => {
	const [library, projects, drives] = laneTree(TREE, {});
	assertEquals([library.key, projects.key, drives.key], [LIBRARY_KEY, PROJECTS_KEY, DRIVES_KEY]);
	assertEquals(library.children.map((row) => row.label), ["Brand"]);
	assertEquals(projects.children.map((row) => row.label), ["Rebrand"]);
	assertEquals(drives.children.map((row) => row.path), [["drives", CONNECTION]]);
	assertEquals(laneTree([], {}).map((row) => row.children.length), [0, 0, 0]);
});

Deno.test("a mounted row is lazy until its children arrive, and an empty answer ends that", () => {
	const lazy = laneTree(TREE, {})[2].children[0];
	assertEquals([lazy.lazy, lazy.fileCount], [true, null]);

	const key = `drives/${CONNECTION}`;
	const empty = laneTree(TREE, { [key]: [] })[2].children[0];
	assertEquals(empty.lazy, false);

	const folder = node({
		segment: "G1",
		nodeKind: "mount",
		label: "Decks",
		readOnly: true,
		folderId: null,
	});
	const opened = laneTree(TREE, { [key]: [folder] })[2].children[0];
	assertEquals(opened.children.map((row) => row.path), [["drives", CONNECTION, "G1"]]);
});

Deno.test("a library folder is never lazy and keeps its real count of nothing", () => {
	const brand = laneTree(TREE, {})[0].children[0];
	assertEquals([brand.lazy, brand.fileCount], [false, 0]);
});

Deno.test("a location selects its row, however the address spells a folder", () => {
	assertEquals(selectedRow(TREE, []), LIBRARY_KEY);
	assertEquals(selectedRow(TREE, ["f1", "f2"]), "f1/f2");
	assertEquals(selectedRow(TREE, ["Brand", "Logos"]), "f1/f2");
	assertEquals(selectedRow(TREE, ["drives", CONNECTION, "G1"]), `drives/${CONNECTION}/G1`);
	assertEquals(selectedRow(TREE, ["mnt-prj-a", "stage"]), "mnt-prj-a/stage");
	assertEquals(selectedRow(TREE, ["gone"]), LIBRARY_KEY);
});

Deno.test("a deep link opens its ancestors and reads each lazy level on the way", () => {
	assertEquals(openChain(["f1", "f2"]), ["f1"]);
	assertEquals(openChain(["drives", CONNECTION, "G1", "G2"]), [
		`drives/${CONNECTION}`,
		`drives/${CONNECTION}/G1`,
	]);
	assertEquals(lazyPrefixes(["drives", CONNECTION, "G1"]), [
		["drives", CONNECTION],
		["drives", CONNECTION, "G1"],
	]);
	assertEquals(lazyPrefixes(["mnt-prj-a", "stage", "unit"]), [["mnt-prj-a"]]);
	assertEquals(lazyPrefixes(["f1", "f2"]), []);
});

Deno.test("a filter keeps every ancestor of a match", () => {
	const rows = filterRows(laneTree(TREE, {}), "logos");
	assertEquals(rows.map((row) => row.label), ["Library"]);
	assertEquals(rows[0].children[0].children.map((row) => row.label), ["Logos"]);
});

Deno.test("each row offers what the brief lists, and a read-only one offers nothing", () => {
	const [library, projects, drives] = laneTree(TREE, {});
	assertEquals(rowActionsOf(library), ["new-folder"]);
	assertEquals(rowActionsOf(library.children[0]), ["new-folder", "folder-color", "delete-folder"]);
	assertEquals(rowActionsOf(projects), []);
	assertEquals(rowActionsOf(projects.children[0]), []);
	assertEquals(rowActionsOf(drives), ["connect-drive"]);
	assertEquals(rowActionsOf(drives.children[0]), ["connect-drive", "disconnect-drive"]);
});

Deno.test("an archived library's rows take no writes", () => {
	const sealed = TREE.map((n) => n.nodeKind === "root" ? { ...n, readOnly: true } : n);
	assertEquals(rowActionsOf(laneTree(sealed, {})[0]), []);
});
