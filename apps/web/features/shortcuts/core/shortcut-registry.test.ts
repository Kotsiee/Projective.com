import { assert, assertEquals, assertFalse } from "@std/assert";
import { ToggleableShortcutId } from "@projective/types/org";
import {
	filterShortcuts,
	getAllShortcuts,
	isShortcutEnabled,
	isShortcutProtected,
	SHORTCUT_CATEGORIES,
	shortcutKeys,
} from "./shortcut-registry.ts";

const ids = (list: { id: string }[]) => list.map((s) => s.id).sort();

Deno.test("registry — the switchable shortcuts are exactly the stored id enum", () => {
	const switchable = getAllShortcuts().filter((s) => !s.isProtected);
	assertEquals(ids(switchable), [...ToggleableShortcutId.options].sort());
});

Deno.test("registry — ids are unique and every group is used, in display order", () => {
	const all = getAllShortcuts();
	assertEquals(new Set(all.map((s) => s.id)).size, all.length);
	const seen = [...new Set(all.map((s) => s.category))];
	assertEquals(seen, [...SHORTCUT_CATEGORIES]);
});

Deno.test("registry — a character-key shortcut is never protected (WCAG 2.1.4)", () => {
	for (const s of getAllShortcuts()) {
		const characterOnly = s.keys.every((key) => key.length === 1);
		if (characterOnly) assertFalse(s.isProtected, `${s.id} must be switchable`);
	}
	assertFalse(isShortcutProtected("focus-search"));
	assertFalse(isShortcutProtected("open-feedback"));
});

Deno.test("registry — a protected shortcut ignores the disabled list; a switchable one obeys it", () => {
	assert(isShortcutEnabled("toggle-sidebar", ["toggle-sidebar"]));
	assert(isShortcutEnabled("dismiss", ["dismiss"]));
	assertFalse(isShortcutEnabled("save", ["save"]));
	assert(isShortcutEnabled("save", ["emoji-picker"]));
});

Deno.test("registry — search reads labels, descriptions and keys on either platform", () => {
	assertEquals(ids(filterShortcuts("emoji")), ["emoji-picker"]);
	assertEquals(ids(filterShortcuts("CTRL+U")), ["attach-library"]);
	assertEquals(ids(filterShortcuts("cmd+shift+u")), ["attach-device"]);
	assertEquals(ids(filterShortcuts("dialog")).includes("dismiss"), true);
	assertEquals(filterShortcuts("  ").length, getAllShortcuts().length);
	assertEquals(filterShortcuts("no such shortcut"), []);
});

Deno.test("registry — Mod reads as ⌘ on Apple and Ctrl elsewhere", () => {
	const save = getAllShortcuts().find((s) => s.id === "save")!;
	assertEquals(shortcutKeys(save, true), ["⌘", "S"]);
	assertEquals(shortcutKeys(save, false), ["Ctrl", "S"]);
});
