import { assertEquals } from "@std/assert";
import {
	bareLetterOf,
	FEEDBACK_SEQUENCE_WINDOW_MS,
	findInThreadShortcutLabel,
	headerSearchShortcutLabel,
	isAppleDevice,
	isEditableTarget,
	isFindInThreadShortcut,
	isFocusHeaderSearchShortcut,
	isFocusLaneSearchShortcut,
	isFocusSearchShortcut,
	isOpenFeedbackShortcut,
	isToggleSidebarShortcut,
	laneSearchShortcutLabel,
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
	assertEquals(
		isFocusHeaderSearchShortcut(slash({ code: "Digit7", ctrlKey: true, shiftKey: true })),
		true,
	);
});

Deno.test("isFocusHeaderSearchShortcut — Shift on the Slash key is the lane's chord, not the header's", () => {
	const chord = press({ key: "/", code: "Slash", ctrlKey: true, shiftKey: true });
	assertEquals(isFocusHeaderSearchShortcut(chord), false);
	assertEquals(isFocusLaneSearchShortcut(chord), true);
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

Deno.test("headerSearchShortcutLabel — ⌘ on Apple devices, Ctrl everywhere else", () => {
	const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
	const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
	const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0";
	assertEquals(headerSearchShortcutLabel(mac), "⌘ /");
	assertEquals(headerSearchShortcutLabel(ipad), "⌘ /");
	assertEquals(headerSearchShortcutLabel(windows), "Ctrl /");
	assertEquals(headerSearchShortcutLabel(""), "Ctrl /");
});

Deno.test("isAppleDevice — Mac and iOS platforms or user agents only", () => {
	assertEquals(isAppleDevice("MacIntel"), true);
	assertEquals(isAppleDevice("iPhone"), true);
	assertEquals(isAppleDevice("Win32"), false);
	assertEquals(isAppleDevice("Linux x86_64"), false);
	assertEquals(isAppleDevice(""), false);
});
// #endregion

// #region The lane search
Deno.test("isFocusLaneSearchShortcut — Ctrl+Shift+/ or Cmd+Shift+/, however the layout reports it", () => {
	const chord = (patch: Partial<ShortcutKey>) =>
		press({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true, ...patch });
	assertEquals(isFocusLaneSearchShortcut(chord({})), true);
	assertEquals(isFocusLaneSearchShortcut(chord({ ctrlKey: false, metaKey: true })), true);
	assertEquals(isFocusLaneSearchShortcut(chord({ key: "/" })), true);
	assertEquals(isFocusLaneSearchShortcut(chord({ code: "Minus" })), true);
});

Deno.test("isFocusLaneSearchShortcut — no Shift, both modifiers, Alt, a held or taken key does not", () => {
	const chord = (patch: Partial<ShortcutKey>) =>
		press({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true, ...patch });
	assertEquals(isFocusLaneSearchShortcut(chord({ shiftKey: false, key: "/" })), false);
	assertEquals(isFocusLaneSearchShortcut(chord({ ctrlKey: false })), false);
	assertEquals(isFocusLaneSearchShortcut(chord({ metaKey: true })), false);
	assertEquals(isFocusLaneSearchShortcut(chord({ altKey: true })), false);
	assertEquals(isFocusLaneSearchShortcut(chord({ repeat: true })), false);
	assertEquals(isFocusLaneSearchShortcut(chord({ defaultPrevented: true })), false);
	assertEquals(isFocusLaneSearchShortcut(chord({ key: "/", code: "Digit7" })), false);
});

Deno.test("laneSearchShortcutLabel — ⇧⌘/ on Apple devices, Ctrl ⇧ / elsewhere", () => {
	assertEquals(laneSearchShortcutLabel(true), "⇧⌘/");
	assertEquals(laneSearchShortcutLabel(false), "Ctrl ⇧ /");
});
// #endregion

// #region The message finder
Deno.test("isFindInThreadShortcut — ⌘F on Apple platforms, Ctrl+F elsewhere", () => {
	const f = (patch: Partial<ShortcutKey>) =>
		press({ key: "f", code: "KeyF", ctrlKey: false, ...patch });
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true }), false), true);
	assertEquals(isFindInThreadShortcut(f({ metaKey: true }), true), true);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, key: "F" }), false), true);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, key: "а" }), false), true);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, repeat: true }), false), true);
});

Deno.test("isFindInThreadShortcut — the other platform's modifier, Shift, Alt or a taken key does not", () => {
	const f = (patch: Partial<ShortcutKey>) =>
		press({ key: "f", code: "KeyF", ctrlKey: false, ...patch });
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true }), true), false);
	assertEquals(isFindInThreadShortcut(f({ metaKey: true }), false), false);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, metaKey: true }), false), false);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, shiftKey: true }), false), false);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, altKey: true }), false), false);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, defaultPrevented: true }), false), false);
	assertEquals(isFindInThreadShortcut(f({}), false), false);
	assertEquals(isFindInThreadShortcut(f({ ctrlKey: true, key: "g", code: "KeyG" }), false), false);
});

Deno.test("findInThreadShortcutLabel — ⌘F or Ctrl+F", () => {
	assertEquals(findInThreadShortcutLabel(true), "⌘F");
	assertEquals(findInThreadShortcutLabel(false), "Ctrl+F");
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
