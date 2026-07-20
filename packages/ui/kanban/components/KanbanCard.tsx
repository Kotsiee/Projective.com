import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";
import { useSortable } from "../../dnd/hooks/useSortable.ts";
import type { KanbanItemRenderCtx } from "../core/types.ts";

/**
 * KanbanCard — one draggable/sortable card. POINTER drag works from anywhere on the card (the context's
 * movement threshold means a click that doesn't move still reaches the card's own `onClick` — e.g. open
 * a detail modal — while a real drag suppresses that click); KEYBOARD drag lives on the dedicated grip
 * (Space/Enter to pick up, Arrows to move, Enter to drop, Escape to cancel), so the card body keeps its
 * own Enter/click behaviour. While dragging the source stays in place, dimmed; the floating ghost mirrors
 * it and the enclosing column draws the drop indicator. Non-draggable cards render inertly.
 */
export interface KanbanCardProps {
	/** The card's item id (the board namespaces the DnD id as `card:{id}`). */
	itemId: string;
	draggable: boolean;
	label: string;
	render: (ctx: KanbanItemRenderCtx) => ComponentChildren;
}

/** A 6-dot grip mark (fresh VNode per render — safe to mount in many cards at once). */
function Grip(): JSX.Element {
	return (
		<svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" fill="currentColor">
			<circle cx="3.5" cy="4" r="1.3" />
			<circle cx="8.5" cy="4" r="1.3" />
			<circle cx="3.5" cy="9" r="1.3" />
			<circle cx="8.5" cy="9" r="1.3" />
			<circle cx="3.5" cy="14" r="1.3" />
			<circle cx="8.5" cy="14" r="1.3" />
		</svg>
	);
}

export function KanbanCard(props: KanbanCardProps): JSX.Element {
	const { itemId, draggable, label, render } = props;
	const sortable = useSortable({
		id: `card:${itemId}`,
		data: { type: "card", accepts: ["card"] },
		disabled: !draggable,
		roleDescription: "draggable ticket",
	});
	const dragging = sortable.isDragging.value;

	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class={cx("ui-kanban__card", dragging && "ui-kanban__card--dragging")}
			data-dragging={dragging || undefined}
			onPointerDown={draggable ? sortable.listeners.onPointerDown : undefined}
		>
			{draggable
				? (
					<button
						type="button"
						class="ui-kanban__card-grip"
						aria-label={`Reorder ${label}`}
						aria-roledescription={sortable.attributes["aria-roledescription"]}
						tabIndex={sortable.attributes.tabIndex}
						onKeyDown={sortable.listeners.onKeyDown}
						onClick={(e) => e.stopPropagation()}
					>
						<Grip />
					</button>
				)
				: null}
			<div class="ui-kanban__card-body">{render({ dragging, overlay: false })}</div>
		</div>
	);
}
