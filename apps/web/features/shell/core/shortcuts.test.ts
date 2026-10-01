import { assertEquals } from "@std/assert";
import {
	isEditableTarget,
	isToggleSidebarShortcut,
	type ShortcutKey,
	type ShortcutTarget,
} from "./shortcuts.ts";

const press = (patch: Partial<ShortcutKey>): ShortcutKey => ({
	key: "b",
	code: "KeyB",
	metaKey: false,
	ctrlKey: true,
	shiftKey: false,
	altKey: false,
	repeat: false,
	defaultPrevented: false,
	...patch,
});

const target = (
	tagName: string,
	inside: string[] = [],
	isContentEditable = false,
): ShortcutTarget => ({
	tagName,
	isContentEditable,
	closest: (selector: string) => inside.some((s) => selector.includes(s)) ? {} : null,
});

// #region The chord
Deno.test("isToggleSidebarShortcut — Ctrl+B and Cmd+B toggle", () => {
	assertEquals(isToggleSidebarShortcut(press({})), true);
	assertEquals(isToggleSidebarShortcut(press({ ctrlKey: false, metaKey: true })), true);
	assertEquals(isToggleSidebarShortcut(press({ key: "B" })), true);
});

Deno.test("isToggleSidebarShortcut — a plain B, an extra modifier or both command keys do not", () => {
	assertEquals(isToggleSidebarShortcut(press({ ctrlKey: false })), false);
	assertEquals(isToggleSidebarShortcut(press({ shiftKey: true })), false);
	assertEquals(isToggleSidebarShortcut(press({ altKey: true })), false);
	assertEquals(isToggleSidebarShortcut(press({ metaKey: true })), false);
	assertEquals(isToggleSidebarShortcut(press({ key: "n", code: "KeyN" })), false);
});

Deno.test("isToggleSidebarShortcut — a held key or one a handler already took is ignored", () => {
	assertEquals(isToggleSidebarShortcut(press({ repeat: true })), false);
	assertEquals(isToggleSidebarShortcut(press({ defaultPrevented: true })), false);
});

Deno.test("isToggleSidebarShortcut — the B key on a non-Latin layout matches by position", () => {
	assertEquals(isToggleSidebarShortcut(press({ key: "и", code: "KeyB" })), true);
	assertEquals(isToggleSidebarShortcut(press({ key: "x", code: "KeyB" })), false);
});
// #endregion

// #region Typing is never hijacked
Deno.test("isEditableTarget — fields, editable regions and the rich-text editor bypass the shortcut", () => {
	assertEquals(isEditableTarget(target("INPUT")), true);
	assertEquals(isEditableTarget(target("TEXTAREA")), true);
	assertEquals(isEditableTarget(target("SELECT")), true);
	assertEquals(isEditableTarget(target("DIV", [], true)), true);
	assertEquals(isEditableTarget(target("P", ["[contenteditable]"])), true);
	assertEquals(isEditableTarget(target("BUTTON", [".ui-rte"])), true);
});

Deno.test("isEditableTarget — the page, a link or a button outside an editor does not", () => {
	assertEquals(isEditableTarget(target("BODY")), false);
	assertEquals(isEditableTarget(target("A")), false);
	assertEquals(isEditableTarget(target("BUTTON")), false);
	assertEquals(isEditableTarget(null), false);
	assertEquals(isEditableTarget(undefined), false);
});
// #endregion
