import type { ComponentChildren, JSX } from "preact";
import { type Signal, useComputed } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { useDraggable } from "../../dnd/hooks/useDraggable.ts";
import { useDroppable } from "../../dnd/hooks/useDroppable.ts";
import { KanbanCard } from "./KanbanCard.tsx";
import type {
	KanbanColumn as KanbanColumnModel,
	KanbanColumnRenderCtx,
	KanbanItemRenderCtx,
} from "../core/types.ts";

/** One resolved card slot for a column (id + draggable flag + its render thunk). */
export interface KanbanColumnItem {
	id: string;
	label: string;
	draggable: boolean;
	render: (ctx: KanbanItemRenderCtx) => ComponentChildren;
}

/**
 * KanbanColumn — a droppable column: a (optionally drag-handle) header, a scrollable card body with a
 * live drop indicator, and an optional footer. The column body is the card drop target; the header is
 * the column-reorder drag handle when the column is `reorderable`. The whole `<section>` is the
 * draggable rect (so the column-drag ghost is column-sized) while only the header carries the listeners.
 * §B.4: the column is a non-interactive container — tonal surface tint + a single hairline, never a
 * four-sided box.
 */
export interface KanbanColumnProps<C> {
	column: KanbanColumnModel<C>;
	items: KanbanColumnItem[];
	/** The board's card drop target — the column derives its own indicator index reactively. */
	dropTarget: Signal<{ columnId: string; renderIndex: number } | null>;
	/** Whether column reordering is enabled board-wide (per-column still gated by `reorderable`). */
	columnDragEnabled: boolean;
	header?: (ctx: KanbanColumnRenderCtx<C>) => ComponentChildren;
	footer?: (column: KanbanColumnModel<C>) => ComponentChildren;
	empty?: (column: KanbanColumnModel<C>) => ComponentChildren;
}

export function KanbanColumn<C>(props: KanbanColumnProps<C>): JSX.Element {
	const { column, items, dropTarget, columnDragEnabled } = props;
	const canReorder = columnDragEnabled && !!column.reorderable;

	const body = useDroppable({
		id: `col:${column.id}`,
		data: { type: "column", accepts: ["card", "column"] },
		disabled: column.disabled,
	});
	const colDrag = useDraggable({
		id: `col:${column.id}`,
		data: { type: "column" },
		disabled: !canReorder,
		roleDescription: "column",
	});

	const count = items.length;
	const overLimit = column.wipLimit != null && count > column.wipLimit;
	const dropIndex = useComputed(() =>
		dropTarget.value && dropTarget.value.columnId === column.id
			? dropTarget.value.renderIndex
			: null
	);

	const headerCtx: KanbanColumnRenderCtx<C> = { column, count, overLimit };
	const indicator = (key: string) => (
		<div key={key} class="ui-kanban__drop-indicator" aria-hidden="true" />
	);

	return (
		<section
			// deno-lint-ignore no-explicit-any
			ref={colDrag.setNodeRef as any}
			class={cx("ui-kanban__column", canReorder && "ui-kanban__column--reorderable")}
			data-over={body.isOver.value || undefined}
			data-overlimit={overLimit || undefined}
			data-dragging={colDrag.isDragging.value || undefined}
			aria-label={column.title}
		>
			<header
				class={cx("ui-kanban__col-header", canReorder && "ui-kanban__col-header--handle")}
				{...(canReorder ? colDrag.attributes : {})}
				{...(canReorder ? colDrag.listeners : {})}
			>
				{props.header ? props.header(headerCtx) : (
					<>
						<span class="ui-kanban__col-title">{column.title}</span>
						<span class="ui-kanban__col-count" aria-hidden="true">
							{column.wipLimit != null ? `${count}/${column.wipLimit}` : count}
						</span>
					</>
				)}
			</header>

			<div
				// deno-lint-ignore no-explicit-any
				ref={body.setNodeRef as any}
				class="ui-kanban__col-body"
				role="list"
			>
				{count === 0 && dropIndex.value === null
					? (
						<div class="ui-kanban__col-empty">
							{props.empty ? props.empty(column) : <span aria-hidden="true" />}
						</div>
					)
					: null}
				{items.map((it, i) => (
					<>
						{dropIndex.value === i ? indicator(`ind-${i}`) : null}
						<div role="listitem" key={it.id}>
							<KanbanCard
								itemId={it.id}
								draggable={it.draggable}
								label={it.label}
								render={it.render}
							/>
						</div>
					</>
				))}
				{dropIndex.value === count ? indicator("ind-end") : null}
			</div>

			{props.footer ? <footer class="ui-kanban__col-footer">{props.footer(column)}</footer> : null}
		</section>
	);
}
