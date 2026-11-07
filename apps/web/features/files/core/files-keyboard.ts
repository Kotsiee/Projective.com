/// <reference lib="dom" />
import type { ToggleableShortcutId } from "@projective/types/org";
import { isEditableTarget } from "@features/shell/core/shortcuts.ts";
import type { DragPayload } from "./files-dnd.ts";
import type { AssetFolder, AssetItem } from "../types/file-types.ts";

/**
 * files-keyboard — the rules of the file explorer's keyboard, as pure functions over the parts of an
 * event they read, so they test without a DOM. {@link useFileExplorerKeyboardShortcuts} is what acts
 * on them, and the shortcut registry (Decision #371) is what describes them.
 */

// #region Cells
/** One item in the canvas. Folders lead, so containers are never buried. */
export type ExplorerCell =
	| { kind: "folder"; folder: AssetFolder }
	| { kind: "asset"; asset: AssetItem };

/** A cell's id, in the one `selection` both kinds share. */
export function cellId(cell: ExplorerCell): string {
	return cell.kind === "folder" ? cell.folder.id : cell.asset.id;
}

/** A cell's name, as a person reads it. */
export function cellName(cell: ExplorerCell): string {
	return cell.kind === "folder" ? cell.folder.name : cell.asset.name;
}

/** The canvas in the order it is painted, in both views. */
export function cellsOf(folders: readonly AssetFolder[], items: readonly AssetItem[]): ExplorerCell[] {
	return [
		...folders.map((folder): ExplorerCell => ({ kind: "folder", folder })),
		...items.map((asset): ExplorerCell => ({ kind: "asset", asset })),
	];
}

/** Whether the viewer may change this folder: a mounted one mirrors its provider. */
export function managesFolder(folder: AssetFolder): boolean {
	return folder.source === "supabase" && folder.canManage;
}

/** Whether the viewer may move, copy, rename or delete this cell. */
export function managesCell(cell: ExplorerCell): boolean {
	return cell.kind === "folder" ? managesFolder(cell.folder) : cell.asset.canManage;
}

/** The rows a set of cells comes to, leaving out what the viewer may not change. */
export function rowsOf(cells: readonly ExplorerCell[]): DragPayload {
	const managed = cells.filter(managesCell);
	return {
		assetIds: managed.flatMap((c) => c.kind === "asset" ? [c.asset.id] : []),
		folderIds: managed.flatMap((c) => c.kind === "folder" ? [c.folder.id] : []),
	};
}
// #endregion

// #region Modifiers
/** The modifier parts of a keyboard or mouse event. */
type Modifiers = Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">;

/**
 * The compound-action modifier: ⌘ on Apple platforms and Ctrl elsewhere, never both and never with Alt
 * (AltGr reports as Ctrl+Alt on Windows, and types characters). Option and Alt need no such helper:
 * both report as `altKey`.
 */
export function isActionKey(e: Modifiers, apple: boolean): boolean {
	return !e.altKey && (apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
}
// #endregion

// #region Keys
/** What a keystroke asks of the explorer. */
export type FilesKeyAction =
	| "find"
	| "select-all"
	| "copy"
	| "cut"
	| "paste"
	| "delete"
	| "rename"
	| "up"
	| "back"
	| "open"
	| "toggle"
	| "dismiss"
	| "move";

/** The registry id of each action a person may switch off (Decision #371). */
export const SWITCHABLE_ACTIONS: Partial<Record<FilesKeyAction, ToggleableShortcutId>> = {
	find: "files-find",
	"select-all": "files-select-all",
	copy: "files-copy",
	cut: "files-cut",
	paste: "files-paste",
	delete: "files-delete",
	rename: "files-rename",
	up: "files-up",
	back: "files-up",
};

const ACTION_LETTERS: Readonly<Record<string, FilesKeyAction>> = {
	f: "find",
	a: "select-all",
	c: "copy",
	x: "cut",
	v: "paste",
};

const PLAIN_KEYS: Readonly<Record<string, FilesKeyAction>> = {
	Delete: "delete",
	Backspace: "up",
	F2: "rename",
	Enter: "open",
	" ": "toggle",
	Escape: "dismiss",
};

/** The parts of a `KeyboardEvent` {@link keyAction} reads. */
export type FilesKey = Modifiers & Pick<KeyboardEvent, "key" | "code" | "shiftKey">;

/**
 * The action a keystroke names, if any. A letter matches by position on a non-Latin layout.
 *
 * Plain Backspace climbs and only the compound form deletes: the Mac's own delete shortcut is
 * ⌘+Backspace, and a key that both climbs and deletes would delete by accident.
 */
export function keyAction(e: FilesKey, apple: boolean): FilesKeyAction | null {
	if (isActionKey(e, apple)) {
		if (e.key === "Backspace") return e.shiftKey ? null : "delete";
		const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : /^Key([A-Z])$/.exec(e.code)?.[1].toLowerCase();
		return e.shiftKey ? null : ACTION_LETTERS[letter ?? ""] ?? null;
	}
	if (e.altKey && !e.ctrlKey && !e.metaKey) return e.key === "ArrowLeft" && !e.shiftKey ? "back" : null;
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	if (/^Arrow|^Home$|^End$/.test(e.key)) return "move";
	return e.shiftKey ? null : PLAIN_KEYS[e.key] ?? null;
}
// #endregion

// #region Zones
/** Where a keystroke landed: which pane it belongs to, if any of the explorer's. */
export type FilesZone = "typing" | "modal" | "tree" | "canvas" | "outside";

/**
 * The zone of a keystroke at `target`. The body counts as the canvas: focus falls there when a focused
 * row leaves the DOM, as a virtualized row does, and that must not take the keyboard away. Inside the
 * side tree the tree's own keys apply, and only the shortcuts that do not depend on the pane reach it.
 */
export function zoneOf(target: Element | null, hub: Element | null, modalOpen: boolean): FilesZone {
	if (modalOpen) return "modal";
	if (isEditableTarget(target)) return "typing";
	if (target?.closest("[role='tree']")) return "tree";
	if (!target || target === target.ownerDocument?.body || hub?.contains(target)) return "canvas";
	return "outside";
}
// #endregion

// #region Movement
/** How many columns a grid holds at `width`, by the arithmetic `VirtualGrid` lays it out with. */
export function gridColumns(width: number, cellWidth: number, gap: number): number {
	return Math.max(1, Math.floor((width + gap) / (cellWidth + gap)) || 1);
}

/**
 * Where a movement key lands from `from` (`-1` when nothing has focus yet), or `null` when the key
 * means nothing here, so it stays the browser's. Clamped, never wrapped: a wrap at a row's end lands
 * somewhere the eye did not follow. A short last row is still a row to land on.
 */
export function stepIndex(key: string, from: number, count: number, columns: number): number | null {
	if (count === 0) return null;
	const last = count - 1;
	if (key === "Home") return 0;
	if (key === "End") return last;
	if (columns === 1 && (key === "ArrowLeft" || key === "ArrowRight")) return null;
	if (from < 0) return 0;
	switch (key) {
		case "ArrowRight":
			return Math.min(from + 1, last);
		case "ArrowLeft":
			return Math.max(from - 1, 0);
		case "ArrowUp":
			return from >= columns ? from - columns : from;
		case "ArrowDown":
			return Math.floor(last / columns) > Math.floor(from / columns) ? Math.min(from + columns, last) : from;
	}
	return null;
}
// #endregion

// #region Paste
/** Where a paste lands: a lone selected folder that takes writes, otherwise the folder in view. */
export function pasteTarget(
	selection: readonly string[],
	folders: readonly AssetFolder[],
	here: string | null,
): string | null {
	const lone = selection.length === 1 ? folders.find((f) => f.id === selection[0]) : undefined;
	return lone && managesFolder(lone) ? lone.id : here;
}
// #endregion
