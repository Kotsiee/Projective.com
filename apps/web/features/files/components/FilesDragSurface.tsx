import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { type DndCollisionDetector, type DndId, useDnd, useDndMonitor } from "@projective/ui/dnd";
import { DRAG_ATTR, dragOf, DROP_ATTR } from "../core/files-dnd.ts";

/**
 * FilesDragSurface — the hub's one drag source, and how it reaches targets it does not own.
 *
 * Every item carries {@link DRAG_ATTR}, and one delegated listener here arms the drag: a virtualized
 * grid and table mount and unmount rows as they scroll, and their row components are not this feature's
 * to hook. The whole row is the handle, and `DndContext`'s activation distance keeps a click a click.
 * Targets are found in the DOM (`core/files-dnd.ts` says why), which is what lets a drop land in the
 * lane, another hydration root, with no shared context.
 *
 * A touch press never arms: a card is most of the screen on a phone, and arming on it would take the
 * gesture that scrolls the page.
 *
 * The keyboard keeps the pick-up it had on the old grip, on `M`, because Enter and Space belong to the
 * card. Arrow keys then step between every target on the page, Enter drops and Escape cancels.
 *
 * Must render inside a `DndContext`, with {@link DRAG_DISTANCE} and {@link underPointer}.
 */

/** Pointer travel before a press becomes a drag. */
export const DRAG_DISTANCE = 6;

/** What takes its own press inside a row: the kebab, the table's check and actions cells. */
const NO_DRAG = "[data-fh-nodrag], [data-dt-check], .ui-dt__tail";

/** The target actually painted under the pointer; a folder is no target for its own drag. */
export const underPointer: DndCollisionDetector = ({ active, pointer }) => {
	const target = document.elementFromPoint(pointer.x, pointer.y)?.closest(`[${DROP_ATTR}]`);
	const id = target?.getAttribute(DROP_ATTR) ?? null;
	const source = dragOf(String(active.id));
	return source.kind === "folder" && source.id === id ? null : id;
};

/** The drag source a press or key landed in, unless it landed on a control of its own. */
function sourceAt(target: EventTarget | null): Element | null {
	if (!(target instanceof Element) || target.closest(NO_DRAG)) return null;
	return target.closest(`[${DRAG_ATTR}]`);
}

/** Move a marking attribute to `el`, wherever it was, in any hydration root. */
function mark(attr: string, el: Element | null): void {
	document.querySelector(`[${attr}]`)?.removeAttribute(attr);
	el?.setAttribute(attr, "true");
}

function targetElement(id: DndId | null): Element | null {
	return id === null ? null : document.querySelector(`[${DROP_ATTR}="${CSS.escape(String(id))}"]`);
}

export function FilesDragSurface({ children }: { children: ComponentChildren }): JSX.Element {
	const dnd = useDnd();
	/** The targets registered for a keyboard drag, which steps over the store's droppables. */
	const registered = useRef<string[]>([]);

	useDndMonitor({
		onDragStart({ active }) {
			mark(
				"data-dragging",
				document.querySelector(`[${DRAG_ATTR}="${CSS.escape(String(active.id))}"]`),
			);
			if (active.sensor !== "keyboard") return;
			const self = dragOf(String(active.id)).id;
			for (const el of document.querySelectorAll(`[${DROP_ATTR}]`)) {
				const id = el.getAttribute(DROP_ATTR) ?? "";
				if (id === self) continue;
				dnd.store.registerDroppable({
					id,
					data: {},
					disabled: false,
					getRect: () => el.isConnected ? el.getBoundingClientRect() : null,
				});
				registered.current.push(id);
			}
		},
		onDragOver({ over }) {
			mark("data-drop-over", targetElement(over));
		},
		onDragEnd() {
			mark("data-dragging", null);
			mark("data-drop-over", null);
			for (const id of registered.current) dnd.store.unregisterDroppable(id);
			registered.current = [];
		},
	});

	return (
		<div
			class="fh-dragsurface"
			onPointerDown={(e) => {
				if (e.pointerType === "touch") return;
				const id = sourceAt(e.target)?.getAttribute(DRAG_ATTR);
				if (!id) return;
				// The ghost starts at the pointer, not at a row that may be as wide as the page.
				const at = new DOMRect(e.clientX, e.clientY, 0, 0);
				dnd.armPointer({ id, data: {}, getRect: () => at }, e);
			}}
			onKeyDown={(e) => {
				if (e.key.toLowerCase() !== "m" || e.ctrlKey || e.metaKey || e.altKey) return;
				const source = sourceAt(e.target);
				const id = source?.getAttribute(DRAG_ATTR);
				if (!source || !id) return;
				e.preventDefault();
				dnd.beginKeyboard({ id, data: {}, getRect: () => source.getBoundingClientRect() });
			}}
			// A thumbnail's own native drag would cancel the pointer stream this drag runs on.
			onDragStart={(e) => e.preventDefault()}
		>
			{children}
		</div>
	);
}
