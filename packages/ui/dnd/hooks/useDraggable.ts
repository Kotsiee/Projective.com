import { type Signal, useComputed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useDnd } from "../core/context.ts";
import type { DndData, DndId } from "../core/types.ts";

/**
 * useDraggable — make an element a drag source within the enclosing {@link DndContext}. Returns the
 * ref setter, the pointer/keyboard listeners to spread, the ARIA attributes, and a reactive
 * `isDragging` signal. Pointer press arms a drag (activated past the context threshold); Space/Enter
 * starts a keyboard drag. The element itself never moves — a {@link DragOverlay} renders the ghost.
 */
export interface UseDraggableOptions {
	id: DndId;
	/** Stable payload (e.g. `{ type: "card" }`) the collision detector reads; keep positional data out. */
	data?: DndData;
	disabled?: boolean;
	/** Accessible role description announced for the handle (default "draggable item"). */
	roleDescription?: string;
}

export interface UseDraggable {
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
	nodeRef: { current: HTMLElement | null };
}

export function useDraggable(opts: UseDraggableOptions): UseDraggable {
	const { id, disabled = false, roleDescription = "draggable item" } = opts;
	const ctx = useDnd();
	const nodeRef = useRef<HTMLElement | null>(null);
	const dataRef = useRef<DndData>(opts.data ?? {});
	dataRef.current = opts.data ?? {};

	useEffect(() => {
		ctx.store.registerDraggable({
			id,
			get data() {
				return dataRef.current;
			},
			getRect: () => nodeRef.current?.getBoundingClientRect() ?? null,
		});
		return () => ctx.store.unregisterDraggable(id);
	}, [id]);

	const isDragging = useComputed(() => ctx.store.active.value?.id === id);

	const source = () => ({
		id,
		data: dataRef.current,
		getRect: () => nodeRef.current?.getBoundingClientRect() ?? null,
		disabled,
	});

	return {
		setNodeRef: (el) => {
			nodeRef.current = el;
		},
		listeners: {
			onPointerDown: (e) => ctx.armPointer(source(), e),
			onKeyDown: (e) => {
				if (disabled || ctx.keyboardActive()) return;
				if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
					e.preventDefault();
					ctx.beginKeyboard(source());
				}
			},
		},
		attributes: {
			role: "button",
			tabIndex: disabled ? -1 : 0,
			"aria-roledescription": roleDescription,
			"aria-disabled": disabled || undefined,
		},
		isDragging,
		nodeRef,
	};
}
