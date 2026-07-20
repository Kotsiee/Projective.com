/**
 * @projective/ui/kanban — a generic, controlled Kanban board (DESIGN_SYSTEM.md §C.1).
 *
 * Built on {@link "@projective/ui/dnd"} (Pointer-Events + keyboard drag). The board is CONTROLLED — it
 * emits {@link KanbanItemMove}/{@link KanbanColumnMove} on drop and never mutates the model — so a
 * consumer can commit immediately or intercept a move (e.g. a warning/confirmation modal) before
 * committing. Column and item drag, drop indicators, WIP counts, sleek scrollbars, elevation-on-drag,
 * reduced-motion jump-to-final, and an `aria-live` keyboard-DnD announcer are all built in.
 */

// #region Board (island) + parts
export { KanbanBoard } from "./islands/KanbanBoard.tsx";
export type { KanbanBoardProps } from "./islands/KanbanBoard.tsx";
export { KanbanCard } from "./components/KanbanCard.tsx";
export type { KanbanCardProps } from "./components/KanbanCard.tsx";
export { KanbanColumn } from "./components/KanbanColumn.tsx";
export type { KanbanColumnItem, KanbanColumnProps } from "./components/KanbanColumn.tsx";
// #endregion

// #region Model
export type {
	KanbanColumn as KanbanColumnModel,
	KanbanColumnMove,
	KanbanColumnRenderCtx,
	KanbanItemMove,
	KanbanItemRenderCtx,
	KanbanRenderColumnHeader,
	KanbanRenderItem,
} from "./core/types.ts";
// #endregion
