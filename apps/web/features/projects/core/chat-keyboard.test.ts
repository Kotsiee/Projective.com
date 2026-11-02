/// <reference lib="dom" />
import { assertEquals } from "@std/assert";
import { attachShortcut } from "./chat-keyboard.ts";

const key = (
	key: string,
	mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {},
) => ({
	key,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...mods,
});

Deno.test("attachShortcut: Ctrl+U is the library, Ctrl+Shift+U the device, off Apple", () => {
	assertEquals(attachShortcut(key("u", { ctrlKey: true }), false), "library");
	assertEquals(attachShortcut(key("U", { ctrlKey: true, shiftKey: true }), false), "device");
	assertEquals(attachShortcut(key("u", { metaKey: true }), false), null);
});

Deno.test("attachShortcut: ⌘ alone on Apple — Ctrl+U stays the text field's", () => {
	assertEquals(attachShortcut(key("u", { metaKey: true }), true), "library");
	assertEquals(attachShortcut(key("U", { metaKey: true, shiftKey: true }), true), "device");
	assertEquals(attachShortcut(key("u", { ctrlKey: true }), true), null);
	assertEquals(attachShortcut(key("u", { ctrlKey: true, metaKey: true }), true), null);
});

Deno.test("attachShortcut: no modifier, Alt (AltGr) or another key is not a shortcut", () => {
	assertEquals(attachShortcut(key("u"), false), null);
	assertEquals(attachShortcut(key("u", { ctrlKey: true, altKey: true }), false), null);
	assertEquals(attachShortcut(key("e", { ctrlKey: true }), false), null);
});
