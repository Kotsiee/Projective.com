import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";
import { useDnd } from "../../dnd/core/context.ts";
import { useSortable } from "../../dnd/hooks/useSortable.ts";
import type { KanbanItemRenderCtx } from "../core/types.ts";

/**
 * KanbanCard — one draggable/sortable card. THE WHOLE CARD IS THE HANDLE: pointer drag starts from
 * anywhere on it (the context's movement threshold means a press that does not move is a click, and
 * a real drag suppresses the click that would otherwise follow), and the card root is the single
 * focusable element — Space picks it up for a keyboard drag (Arrows move · Enter drops · Escape
 * cancels), while Enter, or a click, ACTIVATES it through {@link KanbanCardProps.onActivate} (e.g.
 * opens a detail modal). There is deliberately no separate grip: a grip is a second tab stop per card
 * and a second thing to explain, and a card whose entire surface says "grab me" with `cursor: grab`
 * should be grabbable from wherever it was grabbed.
 *
 * The rendered content is therefore NON-interactive — the consumer's `render` must not nest its own
 * `role="button"`/`tabIndex` root inside this one, or every card becomes two tab stops that both
 * open it. A card that is neither draggable nor activatable renders inertly (no role, no tab stop),
 * and `data-draggable` lets the stylesheet promise a drag only where one exists (§3 gate 11 — a
 * `grab` cursor over a card that refuses to move is a control that renders and does nothing).
 *
 * While dragging the source stays in place, dimmed; the floating ghost mirrors it and the enclosing
 * column draws the drop indicator.
 */
export interface KanbanCardProps {
	/** The card's item id (the board namespaces the DnD id as `card:{id}`). */
	itemId: string;
	draggable: boolean;
	label: string;
	render: (ctx: KanbanItemRenderCtx) => ComponentChildren;
	/** Activate the card — a click that did not become a drag, or Enter (Space too when not draggable). */
	onActivate?: () => void;
}

const isSpace = (key: string): boolean => key === " " || key === "Spacebar";

export function KanbanCard(props: KanbanCardProps): JSX.Element {
	const { itemId, draggable, label, render, onActivate } = props;
	const { keyboardActive } = useDnd();
	const sortable = useSortable({
		id: `card:${itemId}`,
		data: { type: "card", accepts: ["card"] },
		disabled: !draggable,
		roleDescription: "draggable ticket",
	});
	const dragging = sortable.isDragging.value;
	const interactive = draggable || !!onActivate;

	const onKeyDown = (e: KeyboardEvent): void => {
		/*
		 * The keyboard sensor DROPS on Enter/Space from a window CAPTURE listener, which runs — and
		 * tears the drag down — before this bubble handler does, so `keyboardActive()` is already false
		 * by the time the drop's keydown reaches the card. That listener also `preventDefault`s, and a
		 * key the sensor has already consumed is never an activation: without this guard every
		 * keyboard drop would also open the ticket it had just placed.
		 */
		if (e.defaultPrevented || keyboardActive()) return;
		if (isSpace(e.key)) {
			if (draggable) {
				// Prevents default and begins the keyboard drag.
				sortable.listeners.onKeyDown(e);
			} else if (onActivate) {
				e.preventDefault();
				onActivate();
			}
			return;
		}
		if (e.key === "Enter" && onActivate) {
			e.preventDefault();
			onActivate();
		}
	};

	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class={cx("ui-kanban__card", dragging && "ui-kanban__card--dragging")}
			data-dragging={dragging || undefined}
			data-draggable={draggable ? "true" : "false"}
			role={interactive ? "button" : undefined}
			tabIndex={interactive ? 0 : undefined}
			aria-label={interactive ? label : undefined}
			aria-roledescription={draggable ? sortable.attributes["aria-roledescription"] : undefined}
			aria-keyshortcuts={draggable ? "Space" : undefined}
			onPointerDown={draggable ? sortable.listeners.onPointerDown : undefined}
			onClick={onActivate ? () => onActivate() : undefined}
			onKeyDown={interactive ? onKeyDown : undefined}
		>
			<div class="ui-kanban__card-body">{render({ dragging, overlay: false })}</div>
		</div>
	);
}
