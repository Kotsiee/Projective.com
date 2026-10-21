import { assertEquals } from "@std/assert";
import type { AssetTreeNode } from "../types/file-types.ts";
import { resolveTreePath, treeIsStale } from "./folder-tree.ts";

// #region Fixture
function folder(id: string, label: string, children: AssetTreeNode[] = []): AssetTreeNode {
	return {
		segment: id,
		kind: "dir",
		nodeKind: "folder",
		label,
		folderId: id,
		fileCount: 0,
		children,
	};
}

/** The nodes under the host's root row. */
const ROOTS: AssetTreeNode[] = [
	folder("f-brief", "Brief"),
	folder("f-drafts", "Drafts", [folder("f-v2", "v2")]),
];
// #endregion

Deno.test("resolveTreePath matches a folder by id or, case-insensitively, by name", () => {
	assertEquals(resolveTreePath(ROOTS, ["f-drafts", "f-v2"]), {
		path: ["f-drafts", "f-v2"],
		complete: true,
	});
	assertEquals(resolveTreePath(ROOTS, ["drafts", "V2"]), {
		path: ["f-drafts", "f-v2"],
		complete: true,
	});
	assertEquals(resolveTreePath(ROOTS, []), { path: [], complete: true });
});

Deno.test("resolveTreePath keeps the deepest prefix of an address the tree cannot reach", () => {
	assertEquals(resolveTreePath(ROOTS, ["Drafts", "Probe"]), {
		path: ["f-drafts"],
		complete: false,
	});
	assertEquals(resolveTreePath(ROOTS, ["gone"]), { path: [], complete: false });
});

Deno.test("treeIsStale agrees with a listing that shows the tree's own children", () => {
	assertEquals(
		treeIsStale(ROOTS, [], [{ id: "f-brief", name: "Brief" }, { id: "f-drafts", name: "Drafts" }]),
		false,
	);
	assertEquals(treeIsStale(ROOTS, ["Drafts"], [{ id: "f-v2", name: "v2" }]), false);
	assertEquals(treeIsStale(ROOTS, ["f-brief"], []), false);
});

Deno.test("treeIsStale catches a folder added, removed or renamed through the listing", () => {
	assertEquals(treeIsStale(ROOTS, ["f-brief"], [{ id: "f-new", name: "New" }]), true);
	assertEquals(treeIsStale(ROOTS, ["f-drafts"], []), true);
	assertEquals(treeIsStale(ROOTS, ["f-drafts"], [{ id: "f-v2", name: "v3" }]), true);
});

Deno.test("treeIsStale reads a location the tree cannot reach as stale", () => {
	assertEquals(treeIsStale(ROOTS, ["Probe"], []), true);
});
