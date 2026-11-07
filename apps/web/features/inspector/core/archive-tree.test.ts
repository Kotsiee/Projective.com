import { assertEquals } from "@std/assert";
import {
	type ArchiveMember,
	archiveRows,
	archiveTotals,
	buildArchiveTree,
	initialExpansion,
} from "./archive-tree.ts";

function file(path: string, size = 1, packedSize?: number): ArchiveMember {
	return { path, directory: false, size, modified: null, packedSize };
}

function folder(path: string): ArchiveMember {
	return { path, directory: true, size: 0, modified: "2025-01-01T00:00:00" };
}

Deno.test("folders a listing never named are made from their members' paths", () => {
	const root = buildArchiveTree([file("a/b/c.txt", 5), file("a/d.txt", 7)]);
	assertEquals(root.children.map((n) => n.name), ["a"]);
	const a = root.children[0];
	assertEquals([a.size, a.fileCount], [12, 2]);
	assertEquals(a.children.map((n) => [n.name, n.directory]), [["b", true], ["d.txt", false]]);
});

Deno.test("a folder entry and its members meet at one node, in either order", () => {
	const root = buildArchiveTree([file("a/x.txt"), folder("a/"), folder("b/"), file("b/y.txt")]);
	assertEquals(root.children.map((n) => n.name), ["a", "b"]);
	assertEquals(root.children[0].modified, "2025-01-01T00:00:00");
	assertEquals(root.children[1].fileCount, 1);
});

Deno.test("folders sort first, then names in natural order", () => {
	const root = buildArchiveTree([
		file("page10.txt"),
		file("page2.txt"),
		file("zeta/x"),
		file("Alpha.txt"),
	]);
	assertEquals(root.children.map((n) => n.name), ["zeta", "Alpha.txt", "page2.txt", "page10.txt"]);
});

Deno.test("only expanded folders contribute rows", () => {
	const root = buildArchiveTree([file("a/b/c.txt"), file("d.txt")]);
	assertEquals(archiveRows(root, new Set()).map((r) => r.node.path), ["a", "d.txt"]);
	const open = archiveRows(root, new Set(["a", "a/b"]));
	assertEquals(open.map((r) => [r.node.path, r.depth]), [
		["a", 0],
		["a/b", 1],
		["a/b/c.txt", 2],
		["d.txt", 0],
	]);
});

Deno.test("a lone top folder opens itself, down to the first real choice", () => {
	const root = buildArchiveTree([file("pkg/src/a.ts"), file("pkg/src/b.ts")]);
	assertEquals([...initialExpansion(root)], ["pkg", "pkg/src"]);
	assertEquals([...initialExpansion(buildArchiveTree([file("a"), file("b")]))], []);
});

Deno.test("totals count files and folders, and packed bytes only when known", () => {
	assertEquals(archiveTotals([folder("a/"), file("a/x", 10, 4), file("y", 5, 5)]), {
		files: 2,
		folders: 1,
		size: 15,
		packedSize: 9,
	});
	assertEquals(archiveTotals([file("a", 10)]).packedSize, null);
});
