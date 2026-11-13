import { assertEquals } from "@std/assert";
import type { ShortcutKey } from "@features/shell/core/shortcuts.ts";
import {
	isSaveShortcut,
	newTicketChordOf,
	steppedTab,
	ticketTabNumberOf,
	ticketTabStepOf,
} from "./ticket-keyboard.ts";

const press = (key: string, extra: Partial<ShortcutKey> = {}): ShortcutKey => ({
	key,
	code: /^[a-z]$/i.test(key)
		? `Key${key.toUpperCase()}`
		: /^[0-9]$/.test(key)
		? `Digit${key}`
		: key,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	repeat: false,
	defaultPrevented: false,
	...extra,
});

// #region Tab number
Deno.test("ticketTabNumberOf: Ctrl or ⌘ with 1–9 names a zero-based tab", () => {
	assertEquals(ticketTabNumberOf(press("1", { ctrlKey: true })), 0);
	assertEquals(ticketTabNumberOf(press("9", { metaKey: true })), 8);
	assertEquals(ticketTabNumberOf(press("&", { ctrlKey: true, code: "Digit1" })), 0);
	assertEquals(ticketTabNumberOf(press("3", { ctrlKey: true, code: "Numpad3" })), 2);
});

Deno.test("ticketTabNumberOf: 0, a bare digit, extra modifiers or a held key name no tab", () => {
	assertEquals(ticketTabNumberOf(press("0", { ctrlKey: true })), null);
	assertEquals(ticketTabNumberOf(press("2")), null);
	assertEquals(ticketTabNumberOf(press("2", { ctrlKey: true, metaKey: true })), null);
	assertEquals(ticketTabNumberOf(press("2", { ctrlKey: true, shiftKey: true })), null);
	assertEquals(ticketTabNumberOf(press("2", { ctrlKey: true, altKey: true })), null);
	assertEquals(ticketTabNumberOf(press("2", { ctrlKey: true, repeat: true })), null);
	assertEquals(ticketTabNumberOf(press("2", { ctrlKey: true, defaultPrevented: true })), null);
});
// #endregion

// #region Tab step
Deno.test("ticketTabStepOf: Ctrl or ⌘ with ← / → steps; anything else does not", () => {
	assertEquals(ticketTabStepOf(press("ArrowRight", { ctrlKey: true })), 1);
	assertEquals(ticketTabStepOf(press("ArrowLeft", { metaKey: true })), -1);
	assertEquals(ticketTabStepOf(press("ArrowRight", { ctrlKey: true, repeat: true })), 1);
	assertEquals(ticketTabStepOf(press("ArrowRight")), 0);
	assertEquals(ticketTabStepOf(press("ArrowUp", { ctrlKey: true })), 0);
	assertEquals(ticketTabStepOf(press("ArrowLeft", { ctrlKey: true, shiftKey: true })), 0);
	assertEquals(ticketTabStepOf(press("ArrowLeft", { ctrlKey: true, defaultPrevented: true })), 0);
});

Deno.test("steppedTab: wraps at both ends", () => {
	assertEquals(steppedTab(0, 1, 6), 1);
	assertEquals(steppedTab(5, 1, 6), 0);
	assertEquals(steppedTab(0, -1, 6), 5);
	assertEquals(steppedTab(0, 1, 1), 0);
	assertEquals(steppedTab(0, 1, 0), -1);
});
// #endregion

// #region Save
Deno.test("isSaveShortcut: Ctrl or ⌘ with S, held or not, never with Alt", () => {
	assertEquals(isSaveShortcut(press("s", { ctrlKey: true })), true);
	assertEquals(isSaveShortcut(press("S", { metaKey: true, shiftKey: true })), true);
	assertEquals(isSaveShortcut(press("s", { ctrlKey: true, repeat: true })), true);
	assertEquals(isSaveShortcut(press("ы", { ctrlKey: true, code: "KeyS" })), true);
	assertEquals(isSaveShortcut(press("s")), false);
	assertEquals(isSaveShortcut(press("s", { ctrlKey: true, altKey: true })), false);
	assertEquals(isSaveShortcut(press("s", { ctrlKey: true, defaultPrevented: true })), false);
});
// #endregion

// #region New ticket
Deno.test("newTicketChordOf: a bare N, or Ctrl/⌘+N alone", () => {
	assertEquals(newTicketChordOf(press("n")), "bare");
	assertEquals(newTicketChordOf(press("т", { code: "KeyN" })), "bare");
	assertEquals(newTicketChordOf(press("n", { ctrlKey: true })), "command");
	assertEquals(newTicketChordOf(press("n", { metaKey: true })), "command");
});

Deno.test("newTicketChordOf: Shift, Alt, a held key or another letter is not a request", () => {
	assertEquals(newTicketChordOf(press("N", { shiftKey: true })), null);
	assertEquals(newTicketChordOf(press("n", { ctrlKey: true, shiftKey: true })), null);
	assertEquals(newTicketChordOf(press("n", { altKey: true })), null);
	assertEquals(newTicketChordOf(press("n", { repeat: true })), null);
	assertEquals(newTicketChordOf(press("n", { ctrlKey: true, repeat: true })), null);
	assertEquals(newTicketChordOf(press("m")), null);
});
// #endregion
