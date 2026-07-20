import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import type { DndId } from "../core/types.ts";

/**
 * SortableContext (aliased {@link SortableContainer}) — declares the ordered item ids + axis of a
 * reorderable list so descendant {@link useSortable} items and keyboard navigation share one notion of
 * order. It renders NO DOM (compose it inside a {@link Droppable}/column container). Consumers read it
 * with {@link useSortableContext}; the Kanban board derives insertion indices from live rects, so this
 * is an optional ergonomic layer, not a requirement for a drop to resolve.
 */
export type SortableStrategy = "vertical" | "horizontal";

export interface SortableContextValue {
	items: readonly DndId[];
	strategy: SortableStrategy;
}

const Ctx = createContext<SortableContextValue | null>(null);

/** Read the nearest {@link SortableContext}, or `null` when none encloses. */
export function useSortableContext(): SortableContextValue | null {
	return useContext(Ctx);
}

export interface SortableContextProps {
	/** The ordered ids of the sortable items in this list. */
	items: readonly DndId[];
	/** Primary axis of the list (default `vertical`). */
	strategy?: SortableStrategy;
	children: ComponentChildren;
}

export function SortableContext(props: SortableContextProps): ComponentChildren {
	const value: SortableContextValue = {
		items: props.items,
		strategy: props.strategy ?? "vertical",
	};
	return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

/** Task-parity alias — the reorderable list container. */
export const SortableContainer = SortableContext;
