import { assert, assertEquals, assertFalse } from "@std/assert";
import type { MenuItem, MenuItemCommandEvent } from "./menu.ts";
import {
	activate,
	edgeFocusable,
	hasChildren,
	isFocusable,
	isSeparator,
	itemKey,
	nextFocusable,
	typeaheadIndex,
	visibleItems,
} from "./menu.ts";

const fakeEvent = {} as Event;

const rows: MenuItem[] = [
	{ label: "Open" },
	{ separator: true },
	{ label: "Rename", disabled: true },
	{ label: "Remove" },
	{ label: "Revoke" },
];

Deno.test("visibleItems drops only explicitly hidden rows", () => {
	const out = visibleItems([{ label: "a" }, { label: "b", visible: false }, { label: "c" }]);
	assertEquals(out.map((i) => i.label), ["a", "c"]);
	assertEquals(visibleItems(undefined), []);
});

Deno.test("isSeparator, hasChildren and isFocusable classify rows", () => {
	assert(isSeparator({ separator: true }));
	assertFalse(isSeparator({ label: "x" }));
	assert(hasChildren({ items: [{ label: "child" }] }));
	assertFalse(hasChildren({ items: [] }));
	assertFalse(hasChildren({ label: "leaf" }));
	assert(isFocusable({ label: "x" }));
	assertFalse(isFocusable({ label: "x", disabled: true }));
	assertFalse(isFocusable({ separator: true }));
});

Deno.test("itemKey prefers key, then label, then position", () => {
	assertEquals(itemKey({ key: "k", label: "L" }, 3), "k");
	assertEquals(itemKey({ label: "L" }, 3), "L");
	assertEquals(itemKey({}, 3), "item-3");
});

Deno.test("activate runs a command and reports a terminal action", () => {
	const seen: MenuItemCommandEvent[] = [];
	const item: MenuItem = { label: "Go", data: 7, command: (e) => seen.push(e) };
	assert(activate(item, fakeEvent));
	assertEquals(seen.length, 1);
	assertEquals(seen[0].item.data, 7);
});

Deno.test("activate is inert for disabled rows and separators; a url is terminal", () => {
	let ran = 0;
	assertFalse(activate({ label: "x", disabled: true, command: () => ran++ }, fakeEvent));
	assertFalse(activate({ separator: true }, fakeEvent));
	assertEquals(ran, 0);
	assert(activate({ label: "Docs", url: "/docs" }, fakeEvent));
	assertFalse(activate({ label: "Parent", items: [{ label: "c" }] }, fakeEvent));
});

Deno.test("nextFocusable wraps and skips separators and disabled rows", () => {
	assertEquals(nextFocusable(rows, 0, 1), 3);
	assertEquals(nextFocusable(rows, 4, 1), 0);
	assertEquals(nextFocusable(rows, 0, -1), 4);
	assertEquals(nextFocusable([], 0, 1), -1);
});

Deno.test("nextFocusable honours a widened predicate", () => {
	const readable = (i: MenuItem) => !isSeparator(i);
	assertEquals(nextFocusable(rows, 0, 1, readable), 2);
});

Deno.test("edgeFocusable finds the first/last focusable, or -1 when none", () => {
	assertEquals(edgeFocusable(rows, "first"), 0);
	assertEquals(edgeFocusable(rows, "last"), 4);
	const dead: MenuItem[] = [{ separator: true }, { label: "x", disabled: true }];
	assertEquals(edgeFocusable(dead, "first"), -1);
	assertEquals(edgeFocusable(dead, "last"), -1);
	assertEquals(edgeFocusable([], "last"), -1);
});

Deno.test("typeaheadIndex searches circularly after `from`, case-insensitively", () => {
	assertEquals(typeaheadIndex(rows, 0, "r"), 3);
	assertEquals(typeaheadIndex(rows, 3, "r"), 4);
	assertEquals(typeaheadIndex(rows, 4, "R"), 3);
	assertEquals(typeaheadIndex(rows, 0, "z"), -1);
	assertEquals(typeaheadIndex(rows, 0, "ren"), -1, "a disabled row is skipped by default");
});
