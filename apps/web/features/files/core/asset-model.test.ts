import { assertEquals } from "@std/assert";
import type { AssetTreeNode } from "../types/file-types.ts";
import {
	breadcrumbsFor,
	filesHref,
	folderQueryHref,
	folderSegmentsOfQuery,
	locationHref,
	rootChildren,
	rootFileCount,
	scopeLabel,
	segmentsOfHref,
} from "./asset-model.ts";

// #region Fixture tree
function node(
	segment: string,
	nodeKind: AssetTreeNode["nodeKind"],
	fileCount: number,
	children: AssetTreeNode[] = [],
): AssetTreeNode {
	return {
		segment,
		kind: nodeKind === "folder" ? "dir" : "stage",
		nodeKind,
		label: segment === "root" ? "My files" : `Label ${segment}`,
		folderId: nodeKind === "root" ? null : segment,
		fileCount,
		children,
	};
}

/** The shape the server answers: the library's own root beside a mounted engagement and a drive. */
const TREE: AssetTreeNode[] = [
	node("root", "root", 14, [node("f-1", "folder", 2, [node("f-1a", "folder", 1)]), node("f-2", "folder", 0)]),
	node("mnt-prj-1", "project", 3),
	node("drv-1", "drive", 0),
];
// #endregion

Deno.test("rootChildren lifts the library root's children into its place", () => {
	assertEquals(rootChildren(TREE).map((n) => n.segment), ["f-1", "f-2", "mnt-prj-1", "drv-1"]);
});

Deno.test("rootChildren leaves a tree without a root node untouched", () => {
	const flat = [node("f-1", "folder", 1), node("mnt-prj-1", "project", 1)];
	assertEquals(rootChildren(flat).map((n) => n.segment), ["f-1", "mnt-prj-1"]);
	assertEquals(rootChildren([]), []);
});

Deno.test("no library folder is ever addressed through a `root` segment", () => {
	// The regression this guards: wrapping the root node made every folder `/files/root/{id}`.
	const paths: string[][] = [];
	const walk = (nodes: readonly AssetTreeNode[], parent: string[]) => {
		for (const n of nodes) {
			paths.push([...parent, n.segment]);
			walk(n.children, [...parent, n.segment]);
		}
	};
	walk(rootChildren(TREE), []);
	assertEquals(paths.some((p) => p[0] === "root"), false);
	assertEquals(paths.find((p) => p.at(-1) === "f-1a"), ["f-1", "f-1a"]);
});

Deno.test("rootFileCount reads the library root's own count, and nothing when there is none", () => {
	assertEquals(rootFileCount(TREE), 14);
	assertEquals(rootFileCount([node("f-1", "folder", 3)]), undefined);
});

Deno.test("a crumb trail over the lifted tree names folders, not their ids", () => {
	const crumbs = breadcrumbsFor(["f-1", "f-1a"], { tree: rootChildren(TREE) });
	assertEquals(crumbs.map((c) => c.label), ["My files", "Label f-1", "Label f-1a"]);
	assertEquals(crumbs.map((c) => c.href), ["/files", "/files/f-1", "/files/f-1/f-1a"]);
});

// #region Console drive routing
Deno.test("a console drive lives in its entity's console, by kind and handle", () => {
	assertEquals(filesHref("workspace", { subjectId: "atelier-nova", kind: "team" }), "/teams/atelier-nova/files");
	assertEquals(filesHref("workspace", { subjectId: "helia", kind: "business" }), "/businesses/helia/files");
	assertEquals(filesHref("workspace", { subjectId: "helia" }), "/files");
	assertEquals(scopeLabel("workspace"), "Shared files");
});

Deno.test("a query-routed folder rides in ?path= and the root drops it", () => {
	const base = "/teams/atelier-nova/files";
	assertEquals(locationHref(base, [], "query"), base);
	assertEquals(locationHref(base, ["Brand", "Logos"], "query"), `${base}?path=Brand/Logos`);
	assertEquals(locationHref(base, ["Brand Kit"], "query", "?path=Old&view=x"), `${base}?view=x&path=Brand%20Kit`);
	assertEquals(locationHref(base, [], "query", "?view=x&path=Old"), `${base}?view=x`);
});

Deno.test("a path-routed folder keeps the hub's address and the current query", () => {
	assertEquals(locationHref("/files", ["Brand", "Logos"], "path"), "/files/Brand/Logos");
	assertEquals(locationHref("/files", [], "path", "?q=1"), "/files?q=1");
});

Deno.test("a folder named a/b survives the query round trip as one segment", () => {
	const href = folderQueryHref("/teams/x/files", ["a/b", "c"]);
	assertEquals(href, "/teams/x/files?path=a%2Fb/c");
	assertEquals(folderSegmentsOfQuery(href.slice(href.indexOf("?"))), ["a/b", "c"]);
	assertEquals(segmentsOfHref(href, "/teams/x/files", "query"), ["a/b", "c"]);
});

Deno.test("segmentsOfHref reads each routing mode, and an address outside the base is the root", () => {
	assertEquals(segmentsOfHref("/files/f-1/f-1a?q=1#top", "/files", "path"), ["f-1", "f-1a"]);
	assertEquals(segmentsOfHref("/teams/x/files?view=y&path=f-1/f-1a", "/teams/x/files", "query"), ["f-1", "f-1a"]);
	assertEquals(segmentsOfHref("/teams/x/files", "/teams/x/files", "query"), []);
	assertEquals(segmentsOfHref("/teams/y/files?path=f-1", "/teams/x/files", "query"), []);
	assertEquals(folderSegmentsOfQuery("?pathx=1&path=%E0%A4%A"), ["%E0%A4%A"]);
});
// #endregion
