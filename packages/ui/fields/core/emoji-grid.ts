// #region Layout
/** One visual row of the grid: the flat index of its first cell and how many cells it holds. */
export interface EmojiGridRow {
	readonly start: number;
	readonly length: number;
}

/**
 * Lay sections of `counts[i]` cells into rows of `columns`. Each section starts a new row (it sits
 * under its own header), so a short last row is followed by the next section's first row.
 */
export function layoutEmojiRows(counts: readonly number[], columns: number): EmojiGridRow[] {
	const rows: EmojiGridRow[] = [];
	const width = Math.max(1, Math.floor(columns));
	let start = 0;
	for (const count of counts) {
		for (let offset = 0; offset < count; offset += width) {
			rows.push({ start: start + offset, length: Math.min(width, count - offset) });
		}
		start += count;
	}
	return rows;
}

function rowOf(rows: readonly EmojiGridRow[], index: number): number {
	let lo = 0;
	let hi = rows.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const row = rows[mid];
		if (index < row.start) hi = mid - 1;
		else if (index >= row.start + row.length) lo = mid + 1;
		else return mid;
	}
	return -1;
}
// #endregion

// #region Navigation
/** A key the grid moves on. */
export type EmojiGridKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

const GRID_KEYS: ReadonlySet<string> = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
]);

/** Whether a key is one {@link moveInEmojiGrid} handles. */
export function isEmojiGridKey(key: string): key is EmojiGridKey {
	return GRID_KEYS.has(key);
}

/**
 * The flat index focus moves to from `index` on `key`, or `"exit-top"` for ArrowUp on the first row
 * (focus returns to the search field). Left/Right follow reading order across rows; Up/Down keep the
 * column, clamped to a shorter row; Home/End go to the row's ends, or the grid's with `toEdge`.
 * Every other boundary stops in place.
 */
export function moveInEmojiGrid(
	rows: readonly EmojiGridRow[],
	index: number,
	key: EmojiGridKey,
	toEdge = false,
): number | "exit-top" {
	if (rows.length === 0) return index;
	const last = rows[rows.length - 1];
	const total = last.start + last.length;
	const current = Math.min(Math.max(index, 0), total - 1);
	const r = rowOf(rows, current);
	const row = rows[r];
	const column = current - row.start;

	switch (key) {
		case "ArrowLeft":
			return Math.max(0, current - 1);
		case "ArrowRight":
			return Math.min(total - 1, current + 1);
		case "ArrowUp": {
			if (r === 0) return "exit-top";
			const above = rows[r - 1];
			return above.start + Math.min(column, above.length - 1);
		}
		case "ArrowDown": {
			if (r === rows.length - 1) return current;
			const below = rows[r + 1];
			return below.start + Math.min(column, below.length - 1);
		}
		case "Home":
			return toEdge ? 0 : row.start;
		case "End":
			return toEdge ? total - 1 : row.start + row.length - 1;
	}
}
// #endregion
