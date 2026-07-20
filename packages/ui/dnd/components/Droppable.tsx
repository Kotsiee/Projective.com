import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";
import { useDroppable, type UseDroppableOptions } from "../hooks/useDroppable.ts";

/**
 * Droppable — a declarative wrapper around {@link useDroppable}. Marks a region as a drop target and
 * exposes a `data-over` hook (+ the `--over` modifier) while a compatible drag hovers it. `data.accepts`
 * gates which drag `type`s land here.
 */
export interface DroppableProps extends UseDroppableOptions {
	children: ComponentChildren;
	as?: keyof JSX.IntrinsicElements;
	class?: string;
}

export function Droppable(props: DroppableProps): JSX.Element {
	const { children, as = "div", class: cls, id, data, disabled } = props;
	const { setNodeRef, isOver } = useDroppable({ id, data, disabled });
	const Tag = as as "div";
	return (
		<Tag
			// deno-lint-ignore no-explicit-any
			ref={setNodeRef as any}
			class={cx("ui-droppable", isOver.value && "ui-droppable--over", cls)}
			data-over={isOver.value || undefined}
		>
			{children}
		</Tag>
	);
}
