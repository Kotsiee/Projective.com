import { bareLetterOf, type ShortcutKey } from "@features/shell/core/shortcuts.ts";

/**
 * ticket-keyboard — the ticket modal's and the board's own shortcuts as pure predicates over the
 * parts of a `KeyboardEvent` they read, beside the listener in `hooks/useTicketShortcuts.ts`
 * (Decision #282: the registry describes, the predicate matches).
 *
 * @module
 */

// #region Shapes
/** How a keystroke asks for a new ticket: a bare `N`, or Ctrl/⌘+N. */
export type NewTicketChord = "bare" | "command";
// #endregion

// #region Predicates
const commandOnly = (e: ShortcutKey): boolean =>
	e.ctrlKey !== e.metaKey && !e.altKey && !e.shiftKey;

const letter = (e: ShortcutKey, want: string): boolean => {
	const key = e.key.toLowerCase();
	return key === want || (!/^[a-z]$/.test(key) && e.code === `Key${want.toUpperCase()}`);
};

/**
 * Ctrl/⌘ with 1–9 and nothing else: the zero-based index of the tab it names, or `null`. Matched
 * by key position too, so a layout that types its digits with Shift (AZERTY) reaches it. A held key
 * does not repeat the switch.
 */
export function ticketTabNumberOf(e: ShortcutKey): number | null {
	if (e.defaultPrevented || e.repeat || !commandOnly(e)) return null;
	const digit = /^[1-9]$/.test(e.key) ? e.key : /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
	return digit ? Number(digit) - 1 : null;
}

/**
 * Ctrl/⌘ with ← or → and nothing else: the direction the tabs step, or `0`. The caller must skip
 * editable targets, where the chord moves the caret by a word or to the line's end.
 */
export function ticketTabStepOf(e: ShortcutKey): -1 | 0 | 1 {
	if (e.defaultPrevented || !commandOnly(e)) return 0;
	return e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
}

/** The tab `step` lands on from `index` in a strip of `count`, wrapping at both ends. */
export function steppedTab(index: number, step: -1 | 1, count: number): number {
	if (count <= 0) return -1;
	return (((index + step) % count) + count) % count;
}

/**
 * Ctrl/⌘+S without Alt, which belongs to the OS and assistive software. A held key still matches,
 * so holding the chord never falls through to the browser's Save Page dialog.
 */
export function isSaveShortcut(e: ShortcutKey): boolean {
	if (e.defaultPrevented || e.altKey || !(e.ctrlKey || e.metaKey)) return false;
	return letter(e, "s");
}

/**
 * A bare `N` (the caller must skip editable targets) or Ctrl/⌘+N with nothing else, or `null`.
 * Browsers keep Ctrl/⌘+N for a new window and seldom hand it to a page, so the bare key is the one
 * that works everywhere.
 */
export function newTicketChordOf(e: ShortcutKey): NewTicketChord | null {
	if (bareLetterOf(e) === "n") return "bare";
	if (e.defaultPrevented || e.repeat || !commandOnly(e)) return null;
	return letter(e, "n") ? "command" : null;
}
// #endregion
