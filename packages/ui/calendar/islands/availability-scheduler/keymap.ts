import { stepColumn } from "./civil.ts";
import type { SchedulerAction, SchedulerState } from "./reducer.ts";

// #region Types
/** The slice of a `KeyboardEvent` the map reads. */
export interface KeyInput {
	key: string;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

/** Where the key was pressed. */
export interface KeyContext {
	/** `canvas` enables the cursor and band keys; `scheduler` only the scheduler-wide ones. */
	scope: "canvas" | "scheduler";
	/** Focus is in a text input, where every key belongs to the input. */
	inTextInput: boolean;
}

/** What a key resolves to: a reducer action, or opening the shortcut sheet. */
export type KeyCommand = SchedulerAction | { type: "openShortcuts" };
// #endregion

// #region Map
function arrow(key: string): "up" | "down" | "left" | "right" | null {
	switch (key) {
		case "ArrowUp":
			return "up";
		case "ArrowDown":
			return "down";
		case "ArrowLeft":
			return "left";
		case "ArrowRight":
			return "right";
		default:
			return null;
	}
}

function canvasKey(e: KeyInput, state: SchedulerState): KeyCommand | null {
	const sel = state.selection;
	const dir = arrow(e.key);
	const mod = e.ctrlKey || e.metaKey;

	if (mod && e.key.toLowerCase() === "d") {
		if (!sel) return null;
		const toDay = stepColumn(sel.day, 1, state.weekStartsOn);
		return toDay === null ? null : { type: "duplicateBand", ...sel, toDay };
	}
	if (mod) return null;

	if (dir) {
		const vertical = dir === "up" || dir === "down";
		const step = dir === "up" ? -state.snap : state.snap;
		if (e.shiftKey && vertical) {
			if (!sel) return null;
			return {
				type: "resizeBand",
				...sel,
				edge: e.altKey ? "start" : "end",
				minutes: step,
			};
		}
		if (e.altKey) {
			if (!sel) return null;
			if (vertical) return { type: "moveBand", ...sel, toDay: sel.day, minutes: step };
			const toDay = stepColumn(sel.day, dir === "left" ? -1 : 1, state.weekStartsOn);
			return toDay === null ? null : { type: "moveBand", ...sel, toDay, minutes: 0 };
		}
		if (e.shiftKey) return null;
		if (vertical) return { type: "moveCursor", toDay: state.cursor.day, minutes: step };
		const toDay = stepColumn(state.cursor.day, dir === "left" ? -1 : 1, state.weekStartsOn);
		return toDay === null ? null : { type: "moveCursor", toDay, minutes: 0 };
	}

	switch (e.key) {
		case "Enter":
			return sel ? { type: "edit", ruleId: sel.ruleId } : {
				type: "createBand",
				day: state.cursor.day,
				start: state.cursor.minute,
				end: state.cursor.minute + 60,
			};
		case "Delete":
		case "Backspace":
			return sel ? { type: "deleteBand", ...sel } : null;
		case "Escape":
			return sel ? { type: "select", selection: null } : null;
		default:
			return null;
	}
}

/**
 * The plan §5.4 keyboard map as a pure function: which command `e` means in `state`, or `null` when
 * the key is not the scheduler's (and must be left to the browser or an enclosing dialog).
 */
export function keyToAction(
	e: KeyInput,
	state: SchedulerState,
	context: KeyContext = { scope: "canvas", inTextInput: false },
): KeyCommand | null {
	if (context.inTextInput) return null;
	const mod = e.ctrlKey || e.metaKey;
	const key = e.key.toLowerCase();

	if (mod && !e.altKey && key === "z") return { type: e.shiftKey ? "redo" : "undo" };
	if (mod && !e.altKey && !e.shiftKey && key === "y") return { type: "redo" };
	if (e.key === "?" && !mod && !e.altKey) return { type: "openShortcuts" };

	if (!mod && !e.altKey && !e.shiftKey) {
		if (key === "w") return { type: "setLayer", layer: "working_hours" };
		if (key === "c") return { type: "setLayer", layer: "call_window" };
		if (e.key === "[") return { type: "shiftMonth", months: -1 };
		if (e.key === "]") return { type: "shiftMonth", months: 1 };
	}

	return context.scope === "canvas" ? canvasKey(e, state) : null;
}

/** True when `target` is a field whose keys belong to it (text, number, date, textarea, editable). */
export function isTextInput(target: EventTarget | null): boolean {
	const el = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
	if (!el?.tagName) return false;
	if (el.isContentEditable) return true;
	if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
	if (el.tagName !== "INPUT") return false;
	return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(
		el.type ?? "text",
	);
}
// #endregion

// #region Shortcut sheet
/** One row of the shortcut sheet. */
export interface ShortcutRow {
	keys: string;
	action: string;
}

/** The rows the shortcut sheet lists, in plan §5.4 order. */
export const SHORTCUTS: readonly ShortcutRow[] = [
	{ keys: "Arrow keys", action: "Move the cursor (one snap step, or one day)" },
	{ keys: "Enter", action: "Create a 1 h band at the cursor, or edit the selected band's rule" },
	{ keys: "Shift + ↑ / ↓", action: "Resize the selected band's end" },
	{ keys: "Alt + Shift + ↑ / ↓", action: "Resize the selected band's start" },
	{ keys: "Alt + ↑ / ↓ / ← / →", action: "Move the selected band in time or across days" },
	{ keys: "Ctrl / ⌘ + D", action: "Duplicate the selected band to the next day" },
	{ keys: "Delete / Backspace", action: "Remove the band (the last band removes its rule)" },
	{ keys: "W / C", action: "Edit working hours / call windows" },
	{ keys: "[ / ]", action: "Previous / next month" },
	{ keys: "Ctrl / ⌘ + Z", action: "Undo" },
	{ keys: "Shift + Ctrl / ⌘ + Z", action: "Redo" },
	{ keys: "Escape", action: "Clear the selection" },
	{ keys: "?", action: "Show these shortcuts" },
	{ keys: "Drag on empty time", action: "Create a band on the active layer" },
	{ keys: "Drag a band or its edge", action: "Move or resize it" },
	{ keys: "Alt + drag", action: "Duplicate to another day" },
	{ keys: "Shift + click a day", action: "Apply the selected band to that day" },
];
// #endregion
