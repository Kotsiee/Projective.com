import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";
import { useDraggable, type UseDraggableOptions } from "../hooks/useDraggable.ts";

/**
 * Draggable — a declarative wrapper around {@link useDraggable}. The whole element is the drag handle;
 * for a partial handle, use the hook directly and spread `listeners`/`attributes` onto the handle node.
 * The element stays in place while dragging (a {@link DragOverlay} shows the ghost) and carries a
 * `data-dragging` hook for styling.
 */
export interface DraggableProps extends UseDraggableOptions {
	children: ComponentChildren;
	/** Intrinsic tag to render (default `div`). */
	as?: keyof JSX.IntrinsicElements;
	class?: string;
	"aria-label"?: string;
}

export function Draggable(props: DraggableProps): JSX.Element {
	const { children, as = "div", class: cls, id, data, disabled, roleDescription } = props;
	const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
		id,
		data,
		disabled,
		roleDescription,
	});
	const Tag = as as "div";
	return (
		<Tag
			// deno-lint-ignore no-explicit-any
			ref={setNodeRef as any}
			class={cx("ui-draggable", isDragging.value && "ui-draggable--dragging", cls)}
			data-dragging={isDragging.value || undefined}
			aria-label={props["aria-label"]}
			{...attributes}
			{...listeners}
		>
			{children}
		</Tag>
	);
}
