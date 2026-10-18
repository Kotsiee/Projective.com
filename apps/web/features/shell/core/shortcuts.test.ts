import { assertEquals } from "@std/assert";
import {
	bareLetterOf,
	FEEDBACK_SEQUENCE_WINDOW_MS,
	isEditableTarget,
	isFocusHeaderSearchShortcut,
	isFocusSearchShortcut,
	isOpenFeedbackShortcut,
	isToggleSidebarShortcut,
	type ShortcutKey,
	type ShortcutPress,
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

// #region The search slash
Deno.test("isFocusSearchShortcut — a bare slash, with or without Shift, focuses search", () => {
	const slash = (patch: Partial<ShortcutKey>) =>
		press({ key: "/", code: "Slash", ctrlKey: false, ...patch });
	assertEquals(isFocusSearchShortcut(slash({})), true);
	assertEquals(isFocusSearchShortcut(slash({ shiftKey: true })), true);
});

Deno.test("isFocusSearchShortcut — a command modifier, a held key or a taken key does not", () => {
	const slash = (patch: Partial<ShortcutKey>) =>
		press({ key: "/", code: "Slash", ctrlKey: false, ...patch });
	assertEquals(isFocusSearchShortcut(slash({ ctrlKey: true })), false);
	assertEquals(isFocusSearchShortcut(slash({ metaKey: true })), false);
	assertEquals(isFocusSearchShortcut(slash({ altKey: true })), false);
	assertEquals(isFocusSearchShortcut(slash({ repeat: true })), false);
	assertEquals(isFocusSearchShortcut(slash({ defaultPrevented: true })), false);
	assertEquals(
		isFocusSearchShortcut(press({ key: "k", code: "KeyK", ctrlKey: false, metaKey: true })),
		false,
	);
});
// #endregion

// #region The header search
Deno.test("isFocusHeaderSearchShortcut — Ctrl+/ or Cmd+/ focuses the header search", () => {
	const slash = (patch: Partial<ShortcutKey>) =>
		press({ key: "/", code: "Slash", ctrlKey: false, ...patch });
	assertEquals(isFocusHeaderSearchShortcut(slash({ ctrlKey: true })), true);
	assertEquals(isFocusHeaderSearchShortcut(slash({ metaKey: true })), true);
	assertEquals(isFocusHeaderSearchShortcut(slash({ ctrlKey: true, shiftKey: true })), true);
});

Deno.test("isFocusHeaderSearchShortcut — a bare slash, both modifiers, Alt or another key does not", () => {
	const slash = (patch: Partial<ShortcutKey>) =>
		press({ key: "/", code: "Slash", ctrlKey: false, ...patch });
	assertEquals(isFocusHeaderSearchShortcut(slash({})), false);
	assertEquals(isFocusHeaderSearchShortcut(slash({ ctrlKey: true, metaKey: true })), false);
	assertEquals(isFocusHeaderSearchShortcut(slash({ ctrlKey: true, altKey: true })), false);
	assertEquals(isFocusHeaderSearchShortcut(slash({ ctrlKey: true, repeat: true })), false);
	assertEquals(
		isFocusHeaderSearchShortcut(press({ key: "-", code: "Slash", ctrlKey: true })),
		false,
	);
});
// #endregion

// #region The feedback sequence
const letter = (key: string, patch: Partial<ShortcutKey> = {}) =>
	press({ key, code: `Key${key.toUpperCase()}`, ctrlKey: false, ...patch });
const g = (at: number, taken = false): ShortcutPress => ({ key: "g", at, taken });

Deno.test("isOpenFeedbackShortcut — g then f within the window opens the feedback board", () => {
	assertEquals(isOpenFeedbackShortcut(letter("f"), g(1000), 1400), true);
	assertEquals(
		isOpenFeedbackShortcut(letter("f"), g(1000), 1000 + FEEDBACK_SEQUENCE_WINDOW_MS),
		true,
	);
});

Deno.test("isOpenFeedbackShortcut — too late, out of order, or without the g does not", () => {
	assertEquals(
		isOpenFeedbackShortcut(letter("f"), g(1000), 1001 + FEEDBACK_SEQUENCE_WINDOW_MS),
		false,
	);
	assertEquals(isOpenFeedbackShortcut(letter("f"), g(2000), 1000), false);
	assertEquals(isOpenFeedbackShortcut(letter("f"), null, 1000), false);
	assertEquals(
		isOpenFeedbackShortcut(letter("f"), { key: "h", at: 1000, taken: false }, 1100),
		false,
	);
	assertEquals(isOpenFeedbackShortcut(letter("g"), g(1000), 1100), false);
});

Deno.test("isOpenFeedbackShortcut — a g another handler took never arms the sequence", () => {
	assertEquals(isOpenFeedbackShortcut(letter("f"), g(1000, true), 1100), false);
	assertEquals(
		isOpenFeedbackShortcut(letter("f", { defaultPrevented: true }), g(1000), 1100),
		false,
	);
});

Deno.test("isOpenFeedbackShortcut — modifiers and held keys never complete it, so no other binding collides", () => {
	for (
		const patch of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, {
			repeat: true,
		}]
	) {
		assertEquals(isOpenFeedbackShortcut(letter("f", patch), g(1000), 1100), false);
	}
	// The other shell bindings are not bare letters at all.
	assertEquals(bareLetterOf(press({ key: "/", code: "Slash", ctrlKey: false })), null);
	assertEquals(bareLetterOf(press({ key: "/", code: "Slash", ctrlKey: true })), null);
	assertEquals(bareLetterOf(press({ key: "b", code: "KeyB", ctrlKey: true })), null);
	assertEquals(
		bareLetterOf(press({ key: "k", code: "KeyK", ctrlKey: false, metaKey: true })),
		null,
	);
});

Deno.test("bareLetterOf — lowercase letters, and the key position on a non-Latin layout", () => {
	assertEquals(bareLetterOf(letter("g")), "g");
	assertEquals(bareLetterOf(press({ key: "п", code: "KeyG", ctrlKey: false })), "g");
	assertEquals(bareLetterOf(press({ key: "а", code: "KeyF", ctrlKey: false })), "f");
	assertEquals(bareLetterOf(press({ key: "Enter", code: "Enter", ctrlKey: false })), null);
	assertEquals(bareLetterOf(press({ key: "1", code: "Digit1", ctrlKey: false })), null);
});
// #endregion
