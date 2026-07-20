import type { Signal } from "@preact/signals";
import { useDraggable, type UseDraggableOptions } from "./useDraggable.ts";
import { useDroppable } from "./useDroppable.ts";

/**
 * useSortable — the reorderable-item primitive: one element that is BOTH a draggable source and a
 * droppable target under the same id, so a drag can target its siblings for fine-grained insertion.
 * The consumer commits the reorder on drop (this hook is presentation-agnostic — it reports state, it
 * does not mutate the list), which keeps it correct under a controlled model and reduced-motion.
 */
export interface UseSortableOptions extends UseDraggableOptions {}

export interface UseSortable {
	setNodeRef: (el: HTMLElement | null) => void;
	listeners: {
		onPointerDown: (e: PointerEvent) => void;
		onKeyDown: (e: KeyboardEvent) => void;
	};
	attributes: {
		role: "button";
		tabIndex: number;
		"aria-roledescription": string;
		"aria-disabled": boolean | undefined;
	};
	isDragging: Signal<boolean>;
	isOver: Signal<boolean>;
}

export function useSortable(opts: UseSortableOptions): UseSortable {
	const drag = useDraggable(opts);
	const drop = useDroppable({ id: opts.id, data: opts.data, disabled: opts.disabled });
	return {
		setNodeRef: (el) => {
			drag.setNodeRef(el);
			drop.setNodeRef(el);
		},
		listeners: drag.listeners,
		attributes: drag.attributes,
		isDragging: drag.isDragging,
		isOver: drop.isOver,
	};
}
