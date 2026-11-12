import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useDnd, useDraggable, useDroppable } from "@projective/ui/dnd";
import { useId } from "@projective/ui/hooks";
import type { MenuItem } from "@ui/types/mod.ts";
import { STAGE_DRAG, stageDndId } from "../../hooks/usePipelineDrop.ts";
import { StageCardMenu } from "./StageCardMenu.tsx";

/**
 * StageCard — one stage in the ticket modal's stage pane, in the Kanban card's language: a solid
 * tonal fill, the card radius and resting elevation, no outline.
 *
 * The whole surface is the handle and the single tab stop, as on `KanbanCard` (Decision #94): a
 * press that does not travel past the context's threshold is a click and activates the card, a
 * press that does picks it up, and Space starts a keyboard drag while Enter activates. The body is
 * non-interactive, and the `…` menu is the surface's sibling rather than its child, so pressing it
 * can never start a drag or select the stage. Right-click, the ContextMenu key and Shift+F10 open the
 * same rows (Decision #222). An included card is also a drop target; an available one is not, since
 * its zone catches the drop.
 */
export interface StageCardProps {
	zone: "included" | "available";
	stageId: string;
	/** The surface's accessible name. */
	label: string;
	draggable: boolean;
	selected?: boolean;
	/** The drag in flight would join this card's band. */
	joinTarget?: boolean;
	/** The card's menu rows, or `null` for none. */
	menu: MenuItem[] | null;
	menuLabel: string;
	onActivate?: () => void;
	children: ComponentChildren;
}

const isSpace = (key: string): boolean => key === " " || key === "Spacebar";

export function StageCard(props: StageCardProps): JSX.Element {
	const { zone, stageId, draggable, onActivate } = props;
	const rootRef = useRef<HTMLDivElement>(null);
	const { keyboardActive } = useDnd();
	const id = stageDndId(zone, stageId);
	const drag = useDraggable({
		id,
		data: STAGE_DRAG,
		disabled: !draggable,
		roleDescription: "draggable stage",
	});
	const drop = useDroppable({ id, data: STAGE_DRAG, disabled: zone !== "included" });
	const bodyId = useId(undefined, "tkc-stage");
	const dragging = drag.isDragging.value;

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
		if (e.defaultPrevented || keyboardActive()) return;
		if (isSpace(e.key)) {
			if (draggable) drag.listeners.onKeyDown(e);
			else if (onActivate) {
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
			ref={(el: HTMLDivElement | null) => {
				rootRef.current = el;
				drag.setNodeRef(el);
				drop.setNodeRef(el);
			}}
			class="tkc-stage"
			data-zone={zone}
			data-stage-id={stageId}
			data-selected={props.selected ? "true" : undefined}
			data-dragging={dragging || undefined}
			data-join={props.joinTarget ? "true" : undefined}
			data-draggable={draggable ? "true" : "false"}
			data-menu={props.menu ? "true" : undefined}
		>
			<div
				class="tkc-stage__surface"
				role="button"
				tabIndex={0}
				aria-label={props.label}
				aria-describedby={bodyId}
				aria-current={props.selected ? "true" : undefined}
				aria-roledescription={draggable ? drag.attributes["aria-roledescription"] : undefined}
				aria-keyshortcuts={draggable ? "Space" : undefined}
				onPointerDown={draggable ? drag.listeners.onPointerDown : undefined}
				onClick={onActivate ? () => onActivate() : undefined}
				onKeyDown={onKeyDown}
			>
				<div id={bodyId} class="tkc-stage__body">{props.children}</div>
			</div>
			{props.menu
				? <StageCardMenu model={props.menu} surface={rootRef} label={props.menuLabel} />
				: null}
		</div>
	);
}
