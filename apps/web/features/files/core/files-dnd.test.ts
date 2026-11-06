import { assertEquals } from "@std/assert";
import {
	dragAttrs,
	dragOf,
	DROP_ATTR,
	dropAttrs,
	folderOfDrop,
	isIdleDrop,
	payloadOf,
} from "./files-dnd.ts";

Deno.test("a drag id round-trips, whatever the id holds", () => {
	const id = Object.values(dragAttrs("asset", "google_drive:F1"))[0];
	assertEquals(dragOf(id), { kind: "asset", id: "google_drive:F1" });
	assertEquals(dragOf("folder:abc"), { kind: "folder", id: "abc" });
});

Deno.test("the library root is a destination, not a missing folder", () => {
	assertEquals(folderOfDrop(dropAttrs(null)[DROP_ATTR]), null);
	assertEquals(folderOfDrop(dropAttrs("abc")[DROP_ATTR]), "abc");
});

Deno.test("a drag from a selected file carries the selection, minus what the viewer cannot move", () => {
	const manageable = new Set(["a", "b"]);
	assertEquals(payloadOf({ kind: "asset", id: "a" }, ["a", "b", "locked"], manageable), {
		assetIds: ["a", "b"],
		folderIds: [],
	});
});

Deno.test("a drag from an unselected file carries only itself", () => {
	const manageable = new Set(["a", "b"]);
	assertEquals(payloadOf({ kind: "asset", id: "b" }, ["a"], manageable).assetIds, ["b"]);
});

Deno.test("a folder travels alone, whatever is selected", () => {
	assertEquals(payloadOf({ kind: "folder", id: "f" }, ["a"], new Set(["a"])), {
		assetIds: [],
		folderIds: ["f"],
	});
});

Deno.test("dropping on where the rows already are, or a folder on itself, does nothing", () => {
	const files = { assetIds: ["a"], folderIds: [] };
	const folder = { assetIds: [], folderIds: ["f"] };
	assertEquals(isIdleDrop(files, "here", "here"), true);
	assertEquals(isIdleDrop(files, null, null), true);
	assertEquals(isIdleDrop(folder, "f", "here"), true);
	assertEquals(isIdleDrop(files, "there", "here"), false);
	assertEquals(isIdleDrop(files, null, "here"), false);
});
