import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useDnd, useDraggable, useDroppable } from "@projective/ui/dnd";
import { Tooltip } from "@projective/ui/feedback";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import type { MenuItem } from "@ui/types/mod.ts";
import { STAGE_DRAG, stageDndId } from "../../hooks/usePipelineDrop.ts";
import { StageCardMenu } from "./StageCardMenu.tsx";

/**
 * StageCard — one stage in the ticket modal's stage pane, in the Kanban card's language: a solid
 * tonal fill, the card radius and resting elevation, no outline.
 *
 * The whole surface is the handle and the single tab stop, as on `KanbanCard` (Decision #94): a
 * press that does not travel past the context's threshold is a click and selects the stage, a press
 * that does picks it up, and Space starts a keyboard drag while Enter selects. Shift+click, a middle
 * click and Shift+Enter add the stage to the ticket or take it out, as the `+` / `−` at the card's
 * end edge does. The body is non-interactive, and the `…` menu and the `+` / `−` are the surface's
 * siblings rather than its children, so pressing them can never start a drag or select the stage.
 * Right-click, the ContextMenu key and Shift+F10 open the menu's rows (Decision #222). An included
 * card is also a keyboard drop target; a pointer drop is read against the pane.
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
	/**
	 * Add the stage to the ticket or take it out — Shift+click, middle click, Shift+Enter and the end
	 * edge's `+` / `−`. Absent where the viewer may not change the pipeline.
	 */
	toggle?: StageCardToggle | null;
	children: ComponentChildren;
}

/** The inclusion toggle a card offers, and why it is refused when it is. */
export interface StageCardToggle {
	/** The `+` / `−` button's accessible name, e.g. "Add Design to this ticket". */
	label: string;
	/** Why the toggle is refused, or `null` when it may run. */
	refusal: string | null;
	run: () => void;
	onRefused: (reason: string) => void;
}

const isSpace = (key: string): boolean => key === " " || key === "Spacebar";
const MIDDLE = 1;

export function StageCard(props: StageCardProps): JSX.Element {
	const { zone, stageId, draggable, onActivate, toggle } = props;
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

	const runToggle = (): void => {
		if (!toggle) return;
		if (toggle.refusal) toggle.onRefused(toggle.refusal);
		else toggle.run();
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
		if (e.button === MIDDLE && toggle) {
			e.preventDefault();
			return;
		}
		if (draggable) drag.listeners.onPointerDown?.(e);
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
		if (e.defaultPrevented || keyboardActive()) return;
		if (e.key === "Enter" && e.shiftKey && toggle) {
			e.preventDefault();
			runToggle();
			return;
		}
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
			data-toggle={toggle ? "true" : undefined}
		>
			<div
				class="tkc-stage__surface"
				role="button"
				tabIndex={0}
				aria-label={props.label}
				aria-describedby={bodyId}
				aria-current={props.selected ? "true" : undefined}
				aria-roledescription={draggable ? drag.attributes["aria-roledescription"] : undefined}
				aria-keyshortcuts={[draggable ? "Space" : "", toggle ? "Shift+Enter" : ""]
					.filter(Boolean).join(" ") || undefined}
				onPointerDown={onPointerDown}
				onMouseDown={(e) => {
					if (e.button === MIDDLE && toggle) e.preventDefault();
				}}
				onAuxClick={(e) => {
					if (e.button !== MIDDLE || !toggle) return;
					e.preventDefault();
					runToggle();
				}}
				onClick={(e) => {
					if (e.shiftKey && toggle) runToggle();
					else onActivate?.();
				}}
				onKeyDown={onKeyDown}
			>
				<div id={bodyId} class="tkc-stage__body">{props.children}</div>
			</div>
			{toggle ? <StageToggle zone={zone} toggle={toggle} onRun={runToggle} /> : null}
			{props.menu
				? <StageCardMenu model={props.menu} surface={rootRef} label={props.menuLabel} />
				: null}
		</div>
	);
}

function StageToggle(
	props: { zone: "included" | "available"; toggle: StageCardToggle; onRun: () => void },
): JSX.Element {
	const { toggle } = props;
	return (
		<div class="tkc-stage__toggleslot">
			<Tooltip content={toggle.refusal ?? toggle.label}>
				<button
					type="button"
					class="tkc-stage__toggle"
					tabIndex={-1}
					aria-label={toggle.label}
					aria-disabled={toggle.refusal ? "true" : undefined}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						props.onRun();
					}}
				>
					<Icon name={props.zone === "available" ? "plus" : "minus"} size="sm" />
				</button>
			</Tooltip>
		</div>
	);
}
