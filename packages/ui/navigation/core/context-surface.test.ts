import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	type ContextIntent,
	isContextMenuKey,
	resolveSurface,
	shouldOpenContextMenu,
} from "./context-surface.ts";

const plain: ContextIntent = {
	handled: false,
	keyboard: false,
	shiftKey: false,
	editable: false,
	selecting: false,
};

Deno.test("shouldOpenContextMenu takes a plain right-click", () => {
	assert(shouldOpenContextMenu(plain));
});

Deno.test("shouldOpenContextMenu yields to an inner surface that already took the event", () => {
	assertFalse(shouldOpenContextMenu({ ...plain, handled: true }));
});

Deno.test("shouldOpenContextMenu leaves Shift+right-click to the browser", () => {
	assertFalse(shouldOpenContextMenu({ ...plain, shiftKey: true }));
});

Deno.test("shouldOpenContextMenu still takes Shift+F10, which carries shiftKey", () => {
	assert(shouldOpenContextMenu({ ...plain, shiftKey: true, keyboard: true }));
});

Deno.test("shouldOpenContextMenu leaves editable text and live selections alone", () => {
	assertFalse(shouldOpenContextMenu({ ...plain, editable: true }));
	assertFalse(shouldOpenContextMenu({ ...plain, selecting: true }));
});

Deno.test("isContextMenuKey recognises the ContextMenu key and Shift+F10 only", () => {
	assert(isContextMenuKey("ContextMenu", false));
	assert(isContextMenuKey("F10", true));
	assertFalse(isContextMenuKey("F10", false));
	assertFalse(isContextMenuKey("Enter", true));
});

Deno.test("resolveSurface reads a ref or calls a getter", () => {
	assertEquals(resolveSurface(undefined), null);
	assertEquals(resolveSurface({ current: null }), null);
	assertEquals(resolveSurface(() => null), null);
});
