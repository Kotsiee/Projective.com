/**
 * The pure model behind `PermissionMatrix`: cell states, the roving-focus key map, which cells may
 * toggle, and the accessible names the grid announces. No DOM, no Preact — every rule the grid's
 * keyboard follows is decided here so it can be unit-tested without a browser.
 *
 * Coordinates are capability-row × role-column indices into the `rows` / `columns` arrays the
 * consumer passes. Group rows are not part of this space: they are headings, never focus stops.
 */

// #region Types
/**
 * One cell's state.
 * - `allowed`: the role holds the capability.
 * - `conditional`: the role holds it under a condition (a cap, an approval, a scope).
 * - `locked`: fixed by the product or the role; readable, never toggled.
 * - `off`: the role does not hold it.
 */
export type PermissionCellState = "allowed" | "conditional" | "locked" | "off";

/** A capability — one row of the matrix. */
export interface PermissionMatrixRow {
	/** Stable key, passed back to `value` / `onToggle`. */
	key: string;
	/** The capability's name; the row header and the first part of every cell's name. */
	label: string;
	/** One line under the label, in the meta register; also describes every cell in the row. */
	hint?: string;
	/** Consecutive rows sharing a group render under one section-header row. */
	group?: string;
	/** Marks a capability that moves money or membership; shown inline beside the hint. */
	sensitive?: boolean;
}

/** A role — one column of the matrix. */
export interface PermissionMatrixColumn {
	/** Stable key, passed back to `value` / `onToggle`. */
	key: string;
	/** The role's name; the column header and the second part of every cell's name. */
	label: string;
	/** One meta line under the label (e.g. "3 members"). */
	meta?: string;
	/** Every cell in a locked column is readable but never toggles (e.g. Owner). */
	locked?: boolean;
	/**
	 * Why this locked column's cells cannot change — describes each of them in place of the matrix's
	 * `lockedHint`, so two kinds of locked column can each give their own reason.
	 */
	lockedHint?: string;
}

/** A cell position: capability row × role column. */
export interface MatrixPos {
	row: number;
	col: number;
}

/** The matrix's extent in capability rows and role columns. */
export interface MatrixDims {
	rows: number;
	cols: number;
}

/** The slice of a `KeyboardEvent` the model reads. */
export interface MatrixKey {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
}

/**
 * What a key press means on the focused cell.
 * - `move`: focus goes to `to` (may equal the current cell at an edge — the key is still consumed).
 * - `toggle`: activation on a cell that may toggle; the native button click carries it out.
 * - `refuse`: activation on a cell that may not toggle; the default is suppressed, nothing changes.
 * - `none`: not a grid key; let it through.
 */
export type MatrixIntent =
	| { kind: "move"; to: MatrixPos }
	| { kind: "toggle"; at: MatrixPos }
	| { kind: "refuse"; at: MatrixPos }
	| { kind: "none" };
// #endregion

// #region State labels
/** The default spoken label per state; the last part of a cell's accessible name. */
export const PERMISSION_STATE_LABELS: Readonly<Record<PermissionCellState, string>> = {
	allowed: "Allowed",
	conditional: "Conditional",
	locked: "Locked",
	off: "Not allowed",
};

/** `"<capability> for <role>: <state>"` — the name every cell announces. */
export function cellAccessibleName(capability: string, role: string, stateLabel: string): string {
	return `${capability} for ${role}: ${stateLabel}`;
}

/**
 * The `aria-pressed` value a toggleable cell carries: `true` / `false` for allowed / off, `mixed`
 * for conditional (the tri-state a toggle button already has a word for), and none for locked,
 * which is not a toggle at all.
 */
export function cellPressed(state: PermissionCellState): "true" | "false" | "mixed" | undefined {
	if (state === "allowed") return "true";
	if (state === "off") return "false";
	if (state === "conditional") return "mixed";
	return undefined;
}
// #endregion

// #region Toggle rule
/**
 * Whether a cell may toggle. A locked state, a locked column, a read-only matrix (no `onToggle`), or
 * a cell the consumer fixed with a reason (`fixedReason`, from `cellLock`) each refuse; all four
 * still take focus so the cell can be read.
 */
export function cellToggleable(
	state: PermissionCellState,
	column: Pick<PermissionMatrixColumn, "locked">,
	interactive: boolean,
	fixedReason?: string | null,
): boolean {
	return interactive && state !== "locked" && column.locked !== true && !fixedReason;
}

/**
 * Why a cell cannot change, or `null` when it can (or the matrix is read-only and the cell is not
 * locked): the consumer's per-cell reason first, then — for a `locked` state or a `locked` column —
 * the column's own `lockedHint`, then the matrix-wide `fallback`. A cell fixed by `fixedReason`
 * keeps the state it draws; only its toggle is withheld.
 */
export function cellLockReason(
	state: PermissionCellState,
	column: Pick<PermissionMatrixColumn, "locked" | "lockedHint">,
	fixedReason: string | null | undefined,
	fallback: string,
): string | null {
	if (fixedReason) return fixedReason;
	if (state === "locked" || column.locked === true) return column.lockedHint || fallback;
	return null;
}

/**
 * One element id per distinct lock reason, so every locked cell is described by the sentence that
 * applies to it without repeating the sentence per cell. The matrix-wide `fallback` always holds
 * `baseId` (it is rendered whether or not a cell uses it); every other reason, in first-seen order,
 * takes `<baseId>-<n>` from 1.
 */
export function lockReasonIds(
	reasons: Iterable<string | null>,
	fallback: string,
	baseId: string,
): Map<string, string> {
	const ids = new Map<string, string>([[fallback, baseId]]);
	for (const reason of reasons) {
		if (reason && !ids.has(reason)) ids.set(reason, `${baseId}-${ids.size}`);
	}
	return ids;
}
// #endregion

// #region Focus geometry
/** Clamp a position into the matrix; an empty matrix yields `{ row: 0, col: 0 }`. */
export function clampPos(pos: MatrixPos, dims: MatrixDims): MatrixPos {
	const row = Math.min(Math.max(pos.row, 0), Math.max(dims.rows - 1, 0));
	const col = Math.min(Math.max(pos.col, 0), Math.max(dims.cols - 1, 0));
	return { row, col };
}

/**
 * Where a navigation key sends focus from `pos`, or `null` when the key is not a navigation key.
 *
 * Arrows do not wrap: at an edge they hold, as a data grid's do (APG), so a held key never jumps
 * the reader to the opposite side of the table. Home/End go to the ends of the current row;
 * Ctrl (or Cmd) + Home/End go to the first and last cell of the whole grid.
 */
export function moveFocus(pos: MatrixPos, key: MatrixKey, dims: MatrixDims): MatrixPos | null {
	if (dims.rows < 1 || dims.cols < 1) return null;
	const at = clampPos(pos, dims);
	const grid = key.ctrlKey === true || key.metaKey === true;
	switch (key.key) {
		case "ArrowRight":
			return clampPos({ row: at.row, col: at.col + 1 }, dims);
		case "ArrowLeft":
			return clampPos({ row: at.row, col: at.col - 1 }, dims);
		case "ArrowDown":
			return clampPos({ row: at.row + 1, col: at.col }, dims);
		case "ArrowUp":
			return clampPos({ row: at.row - 1, col: at.col }, dims);
		case "Home":
			return grid ? { row: 0, col: 0 } : { row: at.row, col: 0 };
		case "End":
			return grid
				? { row: dims.rows - 1, col: dims.cols - 1 }
				: { row: at.row, col: dims.cols - 1 };
		default:
			return null;
	}
}

/** Space or Enter — the keys that activate a cell. */
export function isActivationKey(key: MatrixKey): boolean {
	return key.key === " " || key.key === "Spacebar" || key.key === "Enter";
}

/**
 * The full key map for the focused cell: navigation first, then activation, which `toggle`s only a
 * cell `canToggle` allows and `refuse`s every other.
 */
export function matrixKeyIntent(
	key: MatrixKey,
	pos: MatrixPos,
	dims: MatrixDims,
	canToggle: (at: MatrixPos) => boolean,
): MatrixIntent {
	const to = moveFocus(pos, key, dims);
	if (to) return { kind: "move", to };
	if (isActivationKey(key) && dims.rows > 0 && dims.cols > 0) {
		const at = clampPos(pos, dims);
		return canToggle(at) ? { kind: "toggle", at } : { kind: "refuse", at };
	}
	return { kind: "none" };
}
// #endregion

// #region Groups
/** A run of consecutive rows under one group heading (`group: null` = no heading). */
export interface PermissionRowRun {
	group: string | null;
	rows: Array<{ row: PermissionMatrixRow; index: number }>;
}

/**
 * Split rows into consecutive runs by `group`, keeping each row's index into the original array
 * (the focus coordinate). A group that recurs after another group starts a new run rather than
 * reordering the consumer's rows.
 */
export function groupRuns(rows: readonly PermissionMatrixRow[]): PermissionRowRun[] {
	const runs: PermissionRowRun[] = [];
	rows.forEach((row, index) => {
		const group = row.group ?? null;
		const last = runs.at(-1);
		if (last && last.group === group) last.rows.push({ row, index });
		else runs.push({ group, rows: [{ row, index }] });
	});
	return runs;
}
// #endregion
