import { assertEquals, assertFalse } from "@std/assert";
import type { AssetFolder } from "../types/file-types.ts";
import {
	type FilesKey,
	gridColumns,
	isActionKey,
	keyAction,
	pasteTarget,
	stepIndex,
	typeaheadIndex,
	typedChar,
	zoneOf,
} from "./files-keyboard.ts";

function press(key: string, parts: Partial<FilesKey> = {}): FilesKey {
	return { key, code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...parts };
}

Deno.test("isActionKey is ⌘ on Apple and Ctrl elsewhere, never both, never with Alt", () => {
	assertEquals(isActionKey(press("c", { metaKey: true }), true), true);
	assertEquals(isActionKey(press("c", { ctrlKey: true }), false), true);
	assertFalse(isActionKey(press("c", { ctrlKey: true }), true));
	assertFalse(isActionKey(press("c", { metaKey: true }), false));
	assertFalse(isActionKey(press("c", { ctrlKey: true, metaKey: true }), false));
	assertFalse(isActionKey(press("c", { ctrlKey: true, altKey: true }), false));
});

Deno.test("keyAction reads the compound letters, and by position on a non-Latin layout", () => {
	assertEquals(keyAction(press("f", { ctrlKey: true }), false), "find");
	assertEquals(keyAction(press("i", { ctrlKey: true }), false), "details");
	assertEquals(keyAction(press("i", { metaKey: true }), true), "details");
	assertEquals(keyAction(press("I", { ctrlKey: true, shiftKey: true }), false), null);
	assertEquals(keyAction(press("A", { ctrlKey: true }), false), "select-all");
	assertEquals(keyAction(press("с", { ctrlKey: true, code: "KeyC" }), false), "copy");
	assertEquals(keyAction(press("x", { metaKey: true }), true), "cut");
	assertEquals(keyAction(press("v", { metaKey: true }), true), "paste");
	assertEquals(keyAction(press("v", { ctrlKey: true, shiftKey: true }), false), null);
	assertEquals(keyAction(press("c"), false), null);
});

Deno.test("Backspace climbs, and only Delete or the compound form deletes", () => {
	assertEquals(keyAction(press("Backspace"), false), "up");
	assertEquals(keyAction(press("Delete"), false), "delete");
	assertEquals(keyAction(press("Backspace", { metaKey: true }), true), "delete");
	assertEquals(keyAction(press("Backspace", { ctrlKey: true }), false), "delete");
});

Deno.test("Alt+ArrowLeft goes back; the other Alt arrows stay the browser's", () => {
	assertEquals(keyAction(press("ArrowLeft", { altKey: true }), false), "back");
	assertEquals(keyAction(press("ArrowRight", { altKey: true }), false), null);
});

Deno.test("movement takes Shift, and a compound arrow stays the browser's", () => {
	assertEquals(keyAction(press("ArrowDown", { shiftKey: true }), false), "move");
	assertEquals(keyAction(press("End", { shiftKey: true }), false), "move");
	assertEquals(keyAction(press("ArrowDown", { ctrlKey: true }), false), null);
	assertEquals(keyAction(press("Enter", { shiftKey: true }), false), null);
});

Deno.test("gridColumns follows VirtualGrid's arithmetic and never reaches zero", () => {
	assertEquals(gridColumns(1000, 184, 16), 5);
	assertEquals(gridColumns(983, 184, 16), 4);
	assertEquals(gridColumns(100, 184, 16), 1);
	assertEquals(gridColumns(0, 0, 0), 1);
});

Deno.test("stepIndex moves by one sideways and by the column count vertically", () => {
	assertEquals(stepIndex("ArrowRight", 2, 10, 4), 3);
	assertEquals(stepIndex("ArrowLeft", 2, 10, 4), 1);
	assertEquals(stepIndex("ArrowDown", 1, 10, 4), 5);
	assertEquals(stepIndex("ArrowUp", 5, 10, 4), 1);
});

Deno.test("stepIndex clamps at the edges rather than wrapping", () => {
	assertEquals(stepIndex("ArrowLeft", 0, 10, 4), 0);
	assertEquals(stepIndex("ArrowRight", 9, 10, 4), 9);
	assertEquals(stepIndex("ArrowUp", 2, 10, 4), 2);
	assertEquals(stepIndex("ArrowDown", 9, 10, 4), 9);
});

Deno.test("stepIndex lands on a short last row, and stays when no row lies below", () => {
	assertEquals(stepIndex("ArrowDown", 7, 10, 4), 9);
	assertEquals(stepIndex("ArrowDown", 8, 10, 4), 8);
});

Deno.test("stepIndex starts at the first item, and Home and End jump", () => {
	assertEquals(stepIndex("ArrowDown", -1, 10, 4), 0);
	assertEquals(stepIndex("Home", 7, 10, 4), 0);
	assertEquals(stepIndex("End", 0, 10, 4), 9);
	assertEquals(stepIndex("ArrowDown", 0, 0, 4), null);
});

Deno.test("a list leaves the sideways arrows to the browser", () => {
	assertEquals(stepIndex("ArrowRight", 2, 10, 1), null);
	assertEquals(stepIndex("ArrowDown", 2, 10, 1), 3);
	assertEquals(stepIndex("ArrowUp", 2, 10, 1), 1);
});

Deno.test("a paste lands in a lone selected folder that takes writes, else in the folder in view", () => {
	const mine = { id: "f", source: "supabase", canManage: true } as AssetFolder;
	const mounted = { id: "m", source: "google_drive", canManage: false } as AssetFolder;
	assertEquals(pasteTarget(["f"], [mine], "here"), "f");
	assertEquals(pasteTarget(["f", "a"], [mine], "here"), "here");
	assertEquals(pasteTarget(["a"], [mine], "here"), "here");
	assertEquals(pasteTarget(["m"], [mounted], "here"), "here");
	assertEquals(pasteTarget([], [mine], null), null);
});

Deno.test("zoneOf: a modal and a field take every keystroke; the tree and the canvas are told apart", () => {
	const closestOf = (match: string | null) => (selector: string) =>
		match !== null && selector.includes(match) ? {} : null;
	const body = { tagName: "BODY", closest: closestOf(null) } as unknown as Element;
	const on = (tagName: string, match: string | null = null) =>
		({ tagName, closest: closestOf(match), ownerDocument: { body } }) as unknown as Element;
	const hub = { contains: (el: Element) => el.tagName === "BUTTON" } as unknown as Element;

	assertEquals(zoneOf(on("BUTTON"), hub, true), "modal");
	assertEquals(zoneOf(on("INPUT"), hub, false), "typing");
	assertEquals(zoneOf(on("DIV", "tree"), hub, false), "tree");
	assertEquals(zoneOf(on("BUTTON"), hub, false), "canvas");
	assertEquals(zoneOf(null, hub, false), "canvas");
	assertEquals(zoneOf(on("A"), hub, false), "outside");
});

Deno.test("typeahead lands on the next name that starts with what was typed", () => {
	const names = ["Alpha", "beta", "Apple", "Banana"];
	assertEquals(typeaheadIndex(names, -1, "a"), 0);
	assertEquals(typeaheadIndex(names, 0, "a"), 2);
	assertEquals(typeaheadIndex(names, 2, "a"), 0);
	assertEquals(typeaheadIndex(names, -1, "B"), 1);
	assertEquals(typeaheadIndex(names, 0, "ap"), 2);
	assertEquals(typeaheadIndex(names, 0, "al"), 0);
	assertEquals(typeaheadIndex(names, 0, "aa"), 2);
	assertEquals(typeaheadIndex(names, 0, "z"), null);
	assertEquals(typeaheadIndex([], -1, "a"), null);
});

Deno.test("only an unmodified printable key types into the typeahead", () => {
	const key = (k: string, over: Partial<FilesKey> = {}): FilesKey => ({
		key: k,
		code: "",
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...over,
	});
	assertEquals(typedChar(key("a")), "a");
	assertEquals(typedChar(key("A", { shiftKey: true })), "A");
	assertEquals(typedChar(key("é")), "é");
	assertEquals(typedChar(key(" ")), null);
	assertEquals(typedChar(key("Enter")), null);
	assertEquals(typedChar(key("a", { ctrlKey: true })), null);
});
