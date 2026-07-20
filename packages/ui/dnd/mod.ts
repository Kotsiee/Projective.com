/**
 * @projective/ui/dnd — reusable, dependency-free drag-and-drop primitives (DESIGN_SYSTEM.md §C.1).
 *
 * A small Pointer-Events drag model — NO native HTML5 `draggable`, NO external DnD library (root
 * CLAUDE.md §3 · PRODUCT_SPEC §Libraries). One {@link DndContext} owns a sensor engine (pointer +
 * keyboard) and a signal-first store; {@link Draggable}/{@link Droppable}/{@link SortableContext} (and
 * the {@link useDraggable}/{@link useDroppable}/{@link useSortable} hooks) mark nodes; {@link DragOverlay}
 * renders the elevated ghost through a real body portal. Consumers commit reorders on drop (controlled
 * model), so it stays correct under reduced-motion (jump-to-final) and ships full ARIA + keyboard DnD.
 * The {@link KanbanBoard} (`@projective/ui/kanban`) is the flagship consumer.
 */

// #region Context (island)
export { default as DndContext } from "./islands/DndContext.tsx";
export type { DndContextProps } from "./islands/DndContext.tsx";
// #endregion

// #region Components
export { Draggable } from "./components/Draggable.tsx";
export type { DraggableProps } from "./components/Draggable.tsx";
export { Droppable } from "./components/Droppable.tsx";
export type { DroppableProps } from "./components/Droppable.tsx";
export {
	SortableContainer,
	SortableContext,
	type SortableContextProps,
	type SortableContextValue,
	type SortableStrategy,
	useSortableContext,
} from "./components/SortableContext.tsx";
export { DragOverlay } from "./components/DragOverlay.tsx";
export type { DragOverlayProps } from "./components/DragOverlay.tsx";
// #endregion

// #region Hooks
export { useDraggable } from "./hooks/useDraggable.ts";
export type { UseDraggable, UseDraggableOptions } from "./hooks/useDraggable.ts";
export { useDroppable } from "./hooks/useDroppable.ts";
export type { UseDroppable, UseDroppableOptions } from "./hooks/useDroppable.ts";
export { useSortable } from "./hooks/useSortable.ts";
export type { UseSortable, UseSortableOptions } from "./hooks/useSortable.ts";
export { useDndMonitor } from "./hooks/useDndMonitor.ts";
// #endregion

// #region Core (store · context · collision · types)
export { useDnd } from "./core/context.ts";
export type { DndContextValue, DndDragSource } from "./core/context.ts";
export { createDndStore } from "./core/store.ts";
export type { DndStore } from "./core/store.ts";
export {
	closestCenter,
	defaultCollision,
	type DndDirection,
	nextInDirection,
	pointerWithin,
} from "./core/collision.ts";
export type {
	DndActive,
	DndCollisionArgs,
	DndCollisionDetector,
	DndData,
	DndDraggable,
	DndDroppable,
	DndId,
	DndMonitor,
	DndPoint,
	DndSensor,
	DragEndEvent,
	DragMoveEvent,
	DragOverEvent,
	DragStartEvent,
} from "./core/types.ts";
// #endregion
