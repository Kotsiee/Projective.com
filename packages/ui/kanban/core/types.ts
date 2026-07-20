import type { ComponentChildren } from "preact";

/**
 * @projective/ui/kanban — the generic Kanban board contract.
 *
 * The board is CONTROLLED and presentation-agnostic: the consumer owns `columns` + `items` and commits
 * a reorder on the {@link KanbanBoardProps.onItemMove}/{@link KanbanBoardProps.onColumnMove} callbacks.
 * The board never mutates the model itself — so a consumer can intercept a move (e.g. show a warning
 * modal) and commit only on confirmation, and everything stays correct under reduced-motion.
 */

// #region Column
/** One board column. `C` is the caller's column payload (e.g. a stage or ticket-status descriptor). */
export interface KanbanColumn<C = unknown> {
	id: string;
	title: string;
	/** Block dropping items INTO this column (a truly locked column); default `false`. */
	disabled?: boolean;
	/** Whether this column may be dragged to reorder among its peers (default `false`). */
	reorderable?: boolean;
	/** Whether items may be manually reordered WITHIN this column; else a drop appends (default `false`). */
	sortable?: boolean;
	/** Optional WIP limit — the header flags when the count exceeds it. */
	wipLimit?: number | null;
	/** Arbitrary column payload passed back to the header/footer renderers. */
	data?: C;
}
// #endregion

// #region Moves
/** The item move a drop produces — `toIndex` is the target index in the destination column's item order,
 *  computed as if the dragged item has already been removed from its source. */
export interface KanbanItemMove {
	itemId: string;
	fromColumn: string;
	toColumn: string;
	toIndex: number;
}

/** The column move a drop produces — `toIndex` is the target index among columns after removal. */
export interface KanbanColumnMove {
	columnId: string;
	fromIndex: number;
	toIndex: number;
}
// #endregion

// #region Render contexts
/** Passed to `renderItem`. `overlay` is true when rendering the floating drag ghost. */
export interface KanbanItemRenderCtx {
	dragging: boolean;
	overlay: boolean;
}

/** Passed to `renderColumnHeader`. */
export interface KanbanColumnRenderCtx<C = unknown> {
	column: KanbanColumn<C>;
	count: number;
	overLimit: boolean;
}

export type KanbanRenderItem<T> = (item: T, ctx: KanbanItemRenderCtx) => ComponentChildren;
export type KanbanRenderColumnHeader<C> = (ctx: KanbanColumnRenderCtx<C>) => ComponentChildren;
// #endregion
