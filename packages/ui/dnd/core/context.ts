import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { DndStore } from "./store.ts";
import type { DndData, DndId } from "./types.ts";

/**
 * A drag source handed to the context sensors — a draggable's id, its stable payload, and a live rect
 * getter. Both the pointer and keyboard sensors pick up a drag from one of these.
 */
export interface DndDragSource {
	id: DndId;
	data: DndData;
	getRect: () => DOMRect | null;
	disabled?: boolean;
}

/** The value published by {@link DndContext}. Hooks read it via {@link useDnd}. */
export interface DndContextValue {
	store: DndStore;
	/** Arm a pointer drag from a draggable's `pointerdown` (activates after a small movement threshold). */
	armPointer: (source: DndDragSource, event: PointerEvent) => void;
	/** Pick up / drop / step a keyboard drag from a focused draggable's `keydown`. */
	beginKeyboard: (source: DndDragSource) => void;
	/** Whether a keyboard drag is currently in flight (the sensor owns Arrow/Enter/Escape while true). */
	keyboardActive: () => boolean;
	/**
	 * Re-run hit-testing at the pointer's last position and emit the move, for a container that scrolled
	 * under a pointer that did not move. A no-op unless a pointer drag is in flight.
	 */
	resample: () => void;
}

export const DndCtx = createContext<DndContextValue | null>(null);

/** Read the enclosing {@link DndContext}. Throws when used outside one (a wiring bug). */
export function useDnd(): DndContextValue {
	const ctx = useContext(DndCtx);
	if (!ctx) {
		throw new Error(
			"@projective/ui/dnd: useDraggable/useDroppable/useSortable must be used inside a <DndContext>.",
		);
	}
	return ctx;
}
