/// <reference lib="dom" />
import type { ToggleableShortcutId } from "@projective/types/org";

/**
 * shortcut-registry — the authoritative list of the platform's keyboard shortcuts (Decision #371):
 * what each one is called, what it does, the keys it takes and whether a person may switch it off.
 * The Settings → Keyboard shortcuts console renders from it and every listener asks it before acting.
 *
 * The rule each key MATCHES stays a pure predicate beside its listener (`shell/core/shortcuts.ts`,
 * `projects/core/chat-keyboard.ts`, Decision #282); this file describes, it never matches. The ids a
 * person may switch off are owned by `ToggleableShortcutId` (`@projective/types/org`), so the stored
 * `ui_settings.disabled_shortcuts` and this list cannot drift — the test holds them equal.
 *
 * **Protected** means the keyboard's only route to something: Escape out of an overlay, Tab between
 * controls, the rail toggle, the board's keyboard alternative to dragging. A character-key shortcut is
 * never protected — WCAG 2.1.4 requires that `/` or `G` `F` can be turned off, since speech input and a
 * stray keystroke both fire them. `Cmd+K` is reserved and never shown (Decision #282), so it is absent.
 */

// #region Shapes
/** The console's groups, in display order. */
export const SHORTCUT_CATEGORIES = [
	"Navigation",
	"Messaging",
	"Project board",
	"Files",
	"General",
] as const;
export type ShortcutCategory = (typeof SHORTCUT_CATEGORIES)[number];

/** The shortcuts that can never be switched off. */
export type ProtectedShortcutId =
	| "toggle-sidebar"
	| "focus-next"
	| "focus-previous"
	| "board-move-card"
	| "files-move-focus"
	| "files-open"
	| "files-select"
	| "files-type-to-find"
	| "dismiss";

export type ShortcutId = ToggleableShortcutId | ProtectedShortcutId;

/** One registered shortcut. */
export interface ShortcutDefinition {
	id: ShortcutId;
	category: ShortcutCategory;
	label: string;
	description: string;
	/** Display keys in press order. `Mod` is ⌘ on Apple platforms and Ctrl elsewhere. */
	keys: string[];
	/** Pressed one after another (`G` then `F`) rather than together. */
	sequence?: boolean;
	isProtected: boolean;
}
// #endregion

// #region Registry
const SHORTCUTS: readonly ShortcutDefinition[] = [
	{
		id: "toggle-sidebar",
		category: "Navigation",
		label: "Collapse or expand the sidebar",
		description: "Works anywhere except while you type in a field.",
		keys: ["Mod", "B"],
		isProtected: true,
	},
	{
		id: "focus-header-search",
		category: "Navigation",
		label: "Search the platform",
		description: "Jumps to the search in the header, even from inside a field.",
		keys: ["Mod", "/"],
		isProtected: false,
	},
	{
		id: "focus-search",
		category: "Navigation",
		label: "Search this page",
		description:
			"Jumps to the page's own search, or to the header's search on a page without one. Never while you type in a field.",
		keys: ["/"],
		isProtected: false,
	},
	{
		id: "focus-lane-search",
		category: "Navigation",
		label: "Search the side lane",
		description:
			"Jumps to the search at the top of the side lane: conversations, projects, files, settings. Works from inside a field.",
		keys: ["Mod", "Shift", "/"],
		isProtected: false,
	},
	{
		id: "open-feedback",
		category: "Navigation",
		label: "Send feedback",
		description: "Opens the feedback board's panel from any page.",
		keys: ["G", "F"],
		sequence: true,
		isProtected: false,
	},
	{
		id: "focus-next",
		category: "Navigation",
		label: "Next control",
		description: "Moves focus to the next button, link or field.",
		keys: ["Tab"],
		isProtected: true,
	},
	{
		id: "focus-previous",
		category: "Navigation",
		label: "Previous control",
		description: "Moves focus back to the previous button, link or field.",
		keys: ["Shift", "Tab"],
		isProtected: true,
	},
	{
		id: "emoji-picker",
		category: "Messaging",
		label: "Emoji",
		description: "Opens or closes the emoji picker in the message box.",
		keys: ["Mod", "E"],
		isProtected: false,
	},
	{
		id: "attach-library",
		category: "Messaging",
		label: "Attach from your files",
		description: "Picks files you've already uploaded.",
		keys: ["Mod", "U"],
		isProtected: false,
	},
	{
		id: "attach-device",
		category: "Messaging",
		label: "Upload from your device",
		description: "Opens your device's file dialog.",
		keys: ["Mod", "Shift", "U"],
		isProtected: false,
	},
	{
		id: "voice-message",
		category: "Messaging",
		label: "Record a voice message",
		description: "Hold while the message box is empty to record; let go to stop.",
		keys: ["Ctrl", "Space"],
		isProtected: false,
	},
	{
		id: "find-in-conversation",
		category: "Messaging",
		label: "Find in this conversation",
		description:
			"Opens the message finder in place of the browser's own find, on a conversation or channel chat. Esc closes it.",
		keys: ["Mod", "F"],
		isProtected: false,
	},
	{
		id: "board-move-card",
		category: "Project board",
		label: "Move a card",
		description:
			"Space picks up the focused card, the arrow keys move it, Enter drops it and Escape puts it back.",
		keys: ["Space", "Arrows", "Enter"],
		sequence: true,
		isProtected: true,
	},
	{
		id: "files-move-focus",
		category: "Files",
		label: "Move between files",
		description:
			"The arrow keys, Home and End walk the files in view without changing what's selected. Hold Shift to select as you go.",
		keys: ["Arrows"],
		isProtected: true,
	},
	{
		id: "files-open",
		category: "Files",
		label: "Open",
		description: "Opens the focused folder, or previews the focused file.",
		keys: ["Enter"],
		isProtected: true,
	},
	{
		id: "files-select",
		category: "Files",
		label: "Select the focused item",
		description: "Adds the focused file or folder to the selection, or takes it out.",
		keys: ["Space"],
		isProtected: true,
	},
	{
		id: "files-type-to-find",
		category: "Files",
		label: "Jump to a name",
		description:
			"Typing the start of a name moves to the next file or folder that begins with it. Type the same letter again to step through them.",
		keys: ["A–Z"],
		isProtected: true,
	},
	{
		id: "files-find",
		category: "Files",
		label: "Search files",
		description: "Jumps to the file search in place of the browser's own find.",
		keys: ["Mod", "F"],
		isProtected: false,
	},
	{
		id: "files-details",
		category: "Files",
		label: "Show or hide details",
		description:
			"Opens or closes the details panel. While it's open, clicking a file shows its preview and details there.",
		keys: ["Mod", "I"],
		isProtected: false,
	},
	{
		id: "files-select-all",
		category: "Files",
		label: "Select everything in view",
		description: "Selects every file and folder loaded in this folder.",
		keys: ["Mod", "A"],
		isProtected: false,
	},
	{
		id: "files-copy",
		category: "Files",
		label: "Copy",
		description: "Holds the selected files and folders to paste a copy elsewhere.",
		keys: ["Mod", "C"],
		isProtected: false,
	},
	{
		id: "files-cut",
		category: "Files",
		label: "Cut",
		description: "Holds the selected files and folders to move them. Escape lets go.",
		keys: ["Mod", "X"],
		isProtected: false,
	},
	{
		id: "files-paste",
		category: "Files",
		label: "Paste",
		description: "Pastes into the selected folder, or else into the folder in view.",
		keys: ["Mod", "V"],
		isProtected: false,
	},
	{
		id: "files-delete",
		category: "Files",
		label: "Delete",
		description: "Asks before deleting what's selected. Cmd or Ctrl with Backspace does the same.",
		keys: ["Delete"],
		isProtected: false,
	},
	{
		id: "files-rename",
		category: "Files",
		label: "Rename",
		description: "Edits the selected item's name in place.",
		keys: ["F2"],
		isProtected: false,
	},
	{
		id: "files-up",
		category: "Files",
		label: "Up a folder",
		description: "Goes to the parent folder. Alt with the left arrow goes back.",
		keys: ["Backspace"],
		isProtected: false,
	},
	{
		id: "dismiss",
		category: "General",
		label: "Close or cancel",
		description: "Closes a dialog, menu or tooltip, or cancels a drag.",
		keys: ["Esc"],
		isProtected: true,
	},
	{
		id: "save",
		category: "General",
		label: "Save",
		description: "Saves the project or stage you're editing.",
		keys: ["Mod", "S"],
		isProtected: false,
	},
];
// #endregion

// #region Lookups
/** Every registered shortcut, grouped by {@link SHORTCUT_CATEGORIES} order. */
export function getAllShortcuts(): readonly ShortcutDefinition[] {
	return SHORTCUTS;
}

/** Whether `id` is a shortcut that can never be switched off. */
export function isShortcutProtected(id: string): boolean {
	return SHORTCUTS.some((s) => s.id === id && s.isProtected);
}

/** Whether `id` may fire given the `disabled` list. A protected shortcut always may. */
export function isShortcutEnabled(id: string, disabled: readonly string[]): boolean {
	return isShortcutProtected(id) || !disabled.includes(id);
}

/** A shortcut's keys as this platform spells them (`Mod` → ⌘ or Ctrl). */
export function shortcutKeys(shortcut: ShortcutDefinition, apple: boolean): string[] {
	return shortcut.keys.map((key) => key === "Mod" ? (apple ? "⌘" : "Ctrl") : key);
}

/**
 * The shortcuts whose label, description or keys contain `query` (case-insensitive). `Mod` answers to
 * both "ctrl" and "cmd", so a search works whichever platform the reader learned the keys on.
 */
export function filterShortcuts(query: string): ShortcutDefinition[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...SHORTCUTS];
	return SHORTCUTS.filter((s) => {
		const spell = (mod: string) => s.keys.map((key) => key === "Mod" ? mod : key).join("+");
		return [s.label, s.description, spell("ctrl"), spell("cmd"), spell("⌘")]
			.some((text) => text.toLowerCase().includes(q));
	});
}
// #endregion

// #region Live state
/**
 * The shortcuts switched off on this device: `<html data-shortcuts-off>`, painted by the server from
 * the `pj.a11y` cookie and repainted by Settings the moment a switch moves. Empty on the server.
 */
export function disabledShortcuts(): string[] {
	if (typeof document === "undefined") return [];
	return document.documentElement.dataset.shortcutsOff?.split(" ").filter(Boolean) ?? [];
}

/** Whether a listener may act on `id` now. Read at keydown, so a change in Settings applies at once. */
export function shortcutOn(id: ToggleableShortcutId): boolean {
	return isShortcutEnabled(id, disabledShortcuts());
}
// #endregion
