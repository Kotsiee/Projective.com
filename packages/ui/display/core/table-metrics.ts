/**
 * Row geometry for the `DataTable` virtualizer. Fixed-height rows are arithmetic; variable-height
 * rows keep their sizes in a Fenwick tree, so one measurement updates every later offset in
 * O(log n) and the row at a scroll offset is found in O(log n) — a long list re-measuring as it
 * scrolls never re-walks the whole table.
 */

/** Offsets and sizes of a list of rows, px. */
export interface RowMetrics {
	readonly count: number;
	total(): number;
	sizeOf(index: number): number;
	/** Start of row `index` (or the total for `index === count`). */
	offsetOf(index: number): number;
	/** The row containing `offset`, clamped to the list. */
	indexAt(offset: number): number;
}

/** Every row the same height. */
export function fixedMetrics(count: number, size: number): RowMetrics {
	const h = Math.max(1, size);
	return {
		count,
		total: () => count * h,
		sizeOf: () => h,
		offsetOf: (index) => Math.max(0, Math.min(count, index)) * h,
		indexAt: (offset) => Math.max(0, Math.min(count - 1, Math.floor(offset / h))),
	};
}

/** Rows of individual heights, updatable one at a time. */
export class VariableMetrics implements RowMetrics {
	readonly count: number;
	private readonly sizes: Float64Array;
	private readonly tree: Float64Array;
	private readonly topBit: number;

	constructor(sizes: readonly number[]) {
		this.count = sizes.length;
		this.sizes = Float64Array.from(sizes, (s) => Math.max(0, s));
		this.tree = new Float64Array(this.count + 1);
		for (let i = 0; i < this.count; i++) {
			this.tree[i + 1] += this.sizes[i];
			const parent = i + 1 + ((i + 1) & -(i + 1));
			if (parent <= this.count) this.tree[parent] += this.tree[i + 1];
		}
		let bit = 1;
		while (bit * 2 <= this.count) bit *= 2;
		this.topBit = bit;
	}

	total(): number {
		return this.offsetOf(this.count);
	}

	sizeOf(index: number): number {
		return this.sizes[index] ?? 0;
	}

	offsetOf(index: number): number {
		let sum = 0;
		for (let i = Math.max(0, Math.min(this.count, index)); i > 0; i -= i & -i) sum += this.tree[i];
		return sum;
	}

	/** Set row `index` to `size`; returns the change in px. */
	setSize(index: number, size: number): number {
		if (index < 0 || index >= this.count) return 0;
		const delta = Math.max(0, size) - this.sizes[index];
		if (delta === 0) return 0;
		this.sizes[index] += delta;
		for (let i = index + 1; i <= this.count; i += i & -i) this.tree[i] += delta;
		return delta;
	}

	indexAt(offset: number): number {
		if (this.count === 0) return 0;
		let pos = 0;
		let remaining = offset;
		for (let bit = this.topBit; bit > 0; bit >>= 1) {
			const next = pos + bit;
			if (next <= this.count && this.tree[next] <= remaining) {
				pos = next;
				remaining -= this.tree[next];
			}
		}
		return Math.min(this.count - 1, pos);
	}
}

/** The inclusive row range intersecting `[scroll, scroll + viewport)` plus `overscan` each side. */
export function visibleRange(
	metrics: RowMetrics,
	scroll: number,
	viewport: number,
	overscan: number,
): { start: number; end: number } {
	if (metrics.count === 0) return { start: 0, end: -1 };
	const first = metrics.indexAt(Math.max(0, scroll));
	const last = metrics.indexAt(Math.max(0, scroll + Math.max(0, viewport) - 1));
	return {
		start: Math.max(0, first - overscan),
		end: Math.min(metrics.count - 1, last + overscan),
	};
}

/**
 * The scroll position, within the list, that keeps the same row under the top edge after every row
 * changes from `from` to `to` px — a zoom step must not throw the viewer to a different row.
 */
export function rescaleScroll(scrollInList: number, from: number, to: number): number {
	if (!(from > 0) || !(scrollInList > 0)) return scrollInList;
	return (scrollInList / from) * to;
}
