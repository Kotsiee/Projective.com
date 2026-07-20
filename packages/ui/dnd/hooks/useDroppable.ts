import { type Signal, useComputed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useDnd } from "../core/context.ts";
import type { DndData, DndId } from "../core/types.ts";

/**
 * useDroppable — register an element as a drop target within the enclosing {@link DndContext}. Returns
 * the ref setter and a reactive `isOver` signal (true while the collision detector selects this target).
 * The target's live rect is hit-tested on every pointer/keyboard move; `data.accepts` gates which drag
 * `type`s may land here.
 */
export interface UseDroppableOptions {
	id: DndId;
	data?: DndData;
	disabled?: boolean;
}

export interface UseDroppable {
	setNodeRef: (el: HTMLElement | null) => void;
	isOver: Signal<boolean>;
	nodeRef: { current: HTMLElement | null };
}

export function useDroppable(opts: UseDroppableOptions): UseDroppable {
	const { id, disabled = false } = opts;
	const ctx = useDnd();
	const nodeRef = useRef<HTMLElement | null>(null);
	const dataRef = useRef<DndData>(opts.data ?? {});
	dataRef.current = opts.data ?? {};

	useEffect(() => {
		ctx.store.registerDroppable({
			id,
			get data() {
				return dataRef.current;
			},
			disabled,
			getRect: () => nodeRef.current?.getBoundingClientRect() ?? null,
		});
		return () => ctx.store.unregisterDroppable(id);
	}, [id, disabled]);

	const isOver = useComputed(() => ctx.store.over.value === id);

	return {
		setNodeRef: (el) => {
			nodeRef.current = el;
		},
		isOver,
		nodeRef,
	};
}
