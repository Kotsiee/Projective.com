import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/kanban.css";
import { cx } from "../../core/cx.ts";
import DndContext from "../../dnd/islands/DndContext.tsx";
import { DragOverlay } from "../../dnd/components/DragOverlay.tsx";
import { useDnd } from "../../dnd/core/context.ts";
import { useDndMonitor } from "../../dnd/hooks/useDndMonitor.ts";
import type { DndActive, DndId, DndPoint } from "../../dnd/core/types.ts";
import { KanbanColumn, type KanbanColumnItem } from "../components/KanbanColumn.tsx";
import type {
	KanbanColumn as KanbanColumnModel,
	KanbanColumnMove,
	KanbanItemMove,
	KanbanRenderColumnHeader,
	KanbanRenderItem,
} from "../core/types.ts";

/**
 * KanbanBoard — a generic, controlled Kanban board with Pointer-Events + keyboard drag-and-drop over
 * the {@link DndContext} sensor engine. Columns hold items; a card can be dragged across columns (and
 * reordered within a `sortable` column), and `reorderable` columns can be dragged to re-sequence when
 * `columnsReorderable`. The board never mutates the model — it emits {@link KanbanItemMove}/
 * {@link KanbanColumnMove} so the consumer can commit immediately OR intercept (e.g. confirm a move
 * with a warning modal). Sleek scrollbars come free from the global `:not(html):not(body)` rule; an
 * `aria-live` region announces every pickup/move/drop for keyboard users.
 */
export interface KanbanBoardProps<T, C = unknown> {
	columns: KanbanColumnModel<C>[];
	items: T[];
	getItemId: (item: T) => string;
	/** The id of the column an item currently lives in. */
	getItemColumn: (item: T) => string;
	/** A human label for a11y announcements + the card `aria-label` (default: the item id). */
	getItemLabel?: (item: T) => string;
	renderItem: KanbanRenderItem<T>;
	renderColumnHeader?: KanbanRenderColumnHeader<C>;
	renderColumnFooter?: (column: KanbanColumnModel<C>) => ComponentChildren;
	/** Whether a given item can be picked up at all (default: all draggable). */
	itemDraggable?: (item: T) => boolean;
	onItemMove?: (move: KanbanItemMove) => void;
	onColumnMove?: (move: KanbanColumnMove) => void;
	/** Enable column drag-reorder board-wide (per-column still gated by `column.reorderable`). */
	columnsReorderable?: boolean;
	emptyColumn?: (column: KanbanColumnModel<C>) => ComponentChildren;
	ariaLabel?: string;
	class?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function KanbanBoardInner<T, C>(props: KanbanBoardProps<T, C>): JSX.Element {
	const { store } = useDnd();
	const dropTarget = useSignal<{ columnId: string; renderIndex: number } | null>(null);
	const columnDropIndex = useSignal<number | null>(null);
	const announce = useSignal("");
	const lastAnnounceKey = useRef("");

	// #region Per-render lookups (fresh maps; the monitor reads the latest via useDndMonitor's ref)
	const idOf = props.getItemId;
	const colOf = props.getItemColumn;
	const labelOf = (it: T) => (props.getItemLabel ? props.getItemLabel(it) : idOf(it));

	const idIndex = new Map<DndId, { kind: "card" | "column"; id: string }>();
	for (const c of props.columns) idIndex.set(`col:${c.id}`, { kind: "column", id: c.id });
	for (const it of props.items) idIndex.set(`card:${idOf(it)}`, { kind: "card", id: idOf(it) });

	const columnById = new Map(props.columns.map((c) => [c.id, c] as const));
	const itemsByColumn = new Map<string, T[]>(props.columns.map((c) => [c.id, [] as T[]]));
	const columnOfItem = new Map<string, string>();
	for (const it of props.items) {
		const col = colOf(it);
		columnOfItem.set(idOf(it), col);
		(itemsByColumn.get(col) ?? itemsByColumn.set(col, []).get(col)!).push(it);
	}
	const renderedIds = (colId: string) => (itemsByColumn.get(colId) ?? []).map(idOf);

	const reorderableIdx = props.columns.flatMap((c, i) => (c.reorderable ? [i] : []));
	const firstReorderable = reorderableIdx.length ? reorderableIdx[0] : 0;
	const lastReorderable = reorderableIdx.length
		? reorderableIdx[reorderableIdx.length - 1]
		: props.columns.length - 1;
	// #endregion

	// #region Announcements
	const say = (msg: string, key: string, sensor: DndActive["sensor"], columnChanged: boolean) => {
		// Pointer drags are continuous — announce only when the column changes to avoid flooding the live
		// region; keyboard drags are discrete, so announce every step.
		if (sensor === "pointer" && !columnChanged) return;
		if (lastAnnounceKey.current === key) return;
		lastAnnounceKey.current = key;
		announce.value = msg;
	};
	// #endregion

	// #region Drop-target computation
	function computeCardTarget(
		over: DndId | null,
		pointer: DndPoint,
		active: DndActive,
	): { columnId: string; renderIndex: number } | null {
		if (!over) return null;
		const entry = idIndex.get(over);
		if (!entry) return null;
		const activeItemId = idIndex.get(active.id)?.id ?? "";
		const sourceColumn = columnOfItem.get(activeItemId);

		let columnId: string;
		if (entry.kind === "column") columnId = entry.id;
		else columnId = columnOfItem.get(entry.id) ?? "";
		const col = columnById.get(columnId);
		if (!col || col.disabled) return null;

		const list = renderedIds(columnId);
		let renderIndex: number;
		if (!col.sortable) {
			// No manual ordering in this column: within-column reorder is a no-op; a cross-column drop appends.
			if (columnId === sourceColumn) return null;
			renderIndex = list.length;
		} else if (entry.kind === "column") {
			renderIndex = list.length;
		} else {
			const overIdx = list.indexOf(entry.id);
			if (overIdx === -1) return null;
			if (active.sensor === "keyboard") {
				// Same-column keyboard reorder: insert AFTER the target when stepping DOWN past the active
				// item, else before — so a single Arrow step moves exactly one slot (not a silent no-op).
				const activeIdx = list.indexOf(activeItemId);
				renderIndex = activeIdx !== -1 && overIdx > activeIdx ? overIdx + 1 : overIdx;
			} else {
				const rect = store.droppables.get(over)?.getRect();
				const center = rect ? rect.top + rect.height / 2 : pointer.y;
				renderIndex = pointer.y < center ? overIdx : overIdx + 1;
			}
		}
		return { columnId, renderIndex };
	}

	function computeColumnTarget(
		over: DndId | null,
		pointer: DndPoint,
		active: DndActive,
	): number | null {
		if (!over) return null;
		const entry = idIndex.get(over);
		if (!entry || entry.kind !== "column") return null;
		const overColIdx = props.columns.findIndex((c) => c.id === entry.id);
		if (overColIdx === -1) return null;
		let idx: number;
		if (active.sensor === "keyboard") {
			// Insert AFTER the target when stepping RIGHT past the active column, else before — so a single
			// Arrow step moves the column exactly one slot.
			const activeColIdx = props.columns.findIndex((c) => c.id === idIndex.get(active.id)?.id);
			idx = activeColIdx !== -1 && overColIdx > activeColIdx ? overColIdx + 1 : overColIdx;
		} else {
			const rect = store.droppables.get(over)?.getRect();
			const center = rect ? rect.left + rect.width / 2 : pointer.x;
			idx = pointer.x < center ? overColIdx : overColIdx + 1;
		}
		return clamp(idx, firstReorderable, lastReorderable + 1);
	}
	// #endregion

	// #region Commit
	function commitCard(active: DndActive): void {
		const target = dropTarget.value;
		if (!target) return;
		const activeItemId = idIndex.get(active.id)?.id;
		if (!activeItemId) return;
		const fromColumn = columnOfItem.get(activeItemId) ?? "";
		const list = renderedIds(target.columnId);
		const activeRenderIdx = list.indexOf(activeItemId);
		// Convert the rendered insertion index (which counts the active item when it is in this column)
		// to the destination index AFTER the active item is removed.
		let toIndex = target.renderIndex;
		if (fromColumn === target.columnId && activeRenderIdx !== -1 && activeRenderIdx < toIndex) {
			toIndex -= 1;
		}
		// No-op guard: same column, same resolved slot.
		if (fromColumn === target.columnId && activeRenderIdx === toIndex) return;
		props.onItemMove?.({ itemId: activeItemId, fromColumn, toColumn: target.columnId, toIndex });
	}

	function commitColumn(active: DndActive): void {
		const idx = columnDropIndex.value;
		if (idx == null) return;
		const columnId = idIndex.get(active.id)?.id;
		if (!columnId) return;
		const fromIndex = props.columns.findIndex((c) => c.id === columnId);
		if (fromIndex === -1) return;
		let toIndex = idx;
		if (fromIndex < toIndex) toIndex -= 1;
		if (toIndex === fromIndex) return;
		props.onColumnMove?.({ columnId, fromIndex, toIndex });
	}
	// #endregion

	useDndMonitor({
		onDragStart: (e) => {
			lastAnnounceKey.current = "";
			const entry = idIndex.get(e.active.id);
			if (e.active.data.type === "column") {
				columnDropIndex.value = null;
				announce.value = `Picked up column ${
					columnById.get(entry?.id ?? "")?.title ?? ""
				}. Use Left and Right arrows to move it, Enter to drop, Escape to cancel.`;
			} else {
				dropTarget.value = null;
				const it = props.items.find((x) => idOf(x) === entry?.id);
				announce.value = `Picked up ${
					it ? labelOf(it) : ""
				}. Use arrow keys to move it, Enter to drop, Escape to cancel.`;
			}
		},
		onDragMove: (e) => {
			if (e.active.data.type === "column") {
				const prev = columnDropIndex.value;
				columnDropIndex.value = computeColumnTarget(e.over, e.pointer, e.active);
				if (columnDropIndex.value != null && columnDropIndex.value !== prev) {
					say(
						`Column position ${columnDropIndex.value + 1}`,
						`col:${columnDropIndex.value}`,
						e.active.sensor,
						true,
					);
				}
			} else {
				const prevCol = dropTarget.value?.columnId;
				const next = computeCardTarget(e.over, e.pointer, e.active);
				dropTarget.value = next;
				if (next) {
					const col = columnById.get(next.columnId);
					say(
						`${col?.title ?? ""}, position ${next.renderIndex + 1}`,
						`${next.columnId}:${next.renderIndex}`,
						e.active.sensor,
						next.columnId !== prevCol,
					);
				}
			}
		},
		onDragEnd: (e) => {
			if (!e.canceled) {
				if (e.active.data.type === "column") commitColumn(e.active);
				else commitCard(e.active);
			} else {
				announce.value = "Move cancelled.";
			}
			dropTarget.value = null;
			columnDropIndex.value = null;
			lastAnnounceKey.current = "";
		},
	});

	// #region Overlay content (recomputed only when the active drag changes)
	const active = store.active.value;
	let overlay: ComponentChildren = null;
	if (active) {
		const entry = idIndex.get(active.id);
		if (entry?.kind === "card") {
			const it = props.items.find((x) => idOf(x) === entry.id);
			if (it) {
				overlay = (
					<div class="ui-kanban__card ui-kanban__card--overlay">
						{props.renderItem(it, { dragging: true, overlay: true })}
					</div>
				);
			}
		} else if (entry?.kind === "column") {
			const col = columnById.get(entry.id);
			if (col) {
				overlay = (
					<div class="ui-kanban__col-ghost">
						<span class="ui-kanban__col-title">{col.title}</span>
					</div>
				);
			}
		}
	}
	const columnDragActive = active?.data.type === "column";
	// #endregion

	const colItems = (col: KanbanColumnModel<C>): KanbanColumnItem[] =>
		(itemsByColumn.get(col.id) ?? []).map((it) => ({
			id: idOf(it),
			label: labelOf(it),
			draggable: props.itemDraggable ? props.itemDraggable(it) : true,
			render: (ctx) => props.renderItem(it, ctx),
		}));

	const colIndicator = (key: string) => (
		<div key={key} class="ui-kanban__col-indicator" aria-hidden="true" />
	);

	return (
		<div
			class={cx("ui-kanban", props.class)}
			role="group"
			aria-label={props.ariaLabel ?? "Board"}
			aria-roledescription="Kanban board"
		>
			<div class="ui-kanban__board">
				{props.columns.map((col, i) => (
					<>
						{columnDragActive && columnDropIndex.value === i ? colIndicator(`ci-${i}`) : null}
						<KanbanColumn
							key={col.id}
							column={col}
							items={colItems(col)}
							dropTarget={dropTarget}
							columnDragEnabled={!!props.columnsReorderable}
							header={props.renderColumnHeader}
							footer={props.renderColumnFooter}
							empty={props.emptyColumn}
						/>
					</>
				))}
				{columnDragActive && columnDropIndex.value === props.columns.length
					? colIndicator("ci-end")
					: null}
			</div>

			<DragOverlay>{overlay}</DragOverlay>

			<div class="ui-visually-hidden" role="status" aria-live="assertive" aria-atomic="true">
				{announce.value}
			</div>
		</div>
	);
}

export function KanbanBoard<T, C = unknown>(props: KanbanBoardProps<T, C>): JSX.Element {
	return (
		<DndContext>
			<KanbanBoardInner<T, C> {...props} />
		</DndContext>
	);
}
