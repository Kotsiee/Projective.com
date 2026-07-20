import { type Signal, signal } from "@preact/signals";
import type {
	DndActive,
	DndDraggable,
	DndDroppable,
	DndId,
	DndMonitor,
	DndPoint,
	DragEndEvent,
	DragMoveEvent,
	DragOverEvent,
	DragStartEvent,
} from "./types.ts";

/**
 * The per-context drag store — the single source of truth for one {@link DndContext}. Reactive drag
 * state (`active`/`over`/`pointer`) lives in signals so hooks re-render precisely; the droppable /
 * draggable registries and the monitor set are plain collections (mutated imperatively, never
 * re-rendered). Created once per context via {@link createDndStore}.
 */
export interface DndStore {
	/** The in-flight drag, or `null` when idle. */
	active: Signal<DndActive | null>;
	/** The droppable currently under the drag, or `null`. */
	over: Signal<DndId | null>;
	/** The live pointer position (client coords). */
	pointer: Signal<DndPoint>;
	/** The pointer position at pickup (the drag origin). */
	origin: Signal<DndPoint>;

	droppables: Map<DndId, DndDroppable>;
	draggables: Map<DndId, DndDraggable>;
	monitors: Set<DndMonitor>;

	registerDroppable: (d: DndDroppable) => void;
	unregisterDroppable: (id: DndId) => void;
	registerDraggable: (d: DndDraggable) => void;
	unregisterDraggable: (id: DndId) => void;
	addMonitor: (m: DndMonitor) => void;
	removeMonitor: (m: DndMonitor) => void;

	emitStart: (e: DragStartEvent) => void;
	emitMove: (e: DragMoveEvent) => void;
	emitOver: (e: DragOverEvent) => void;
	emitEnd: (e: DragEndEvent) => void;
}

/** Create a fresh, isolated drag store (one per mounted {@link DndContext}). */
export function createDndStore(): DndStore {
	const droppables = new Map<DndId, DndDroppable>();
	const draggables = new Map<DndId, DndDraggable>();
	const monitors = new Set<DndMonitor>();

	const emit = <T>(pick: (m: DndMonitor) => ((e: T) => void) | undefined, e: T) => {
		for (const m of monitors) {
			try {
				pick(m)?.(e);
			} catch {
				// A misbehaving monitor must never abort the drag loop.
			}
		}
	};

	return {
		active: signal<DndActive | null>(null),
		over: signal<DndId | null>(null),
		pointer: signal<DndPoint>({ x: 0, y: 0 }),
		origin: signal<DndPoint>({ x: 0, y: 0 }),

		droppables,
		draggables,
		monitors,

		registerDroppable: (d) => droppables.set(d.id, d),
		unregisterDroppable: (id) => droppables.delete(id),
		registerDraggable: (d) => draggables.set(d.id, d),
		unregisterDraggable: (id) => draggables.delete(id),
		addMonitor: (m) => monitors.add(m),
		removeMonitor: (m) => monitors.delete(m),

		emitStart: (e) => emit((m) => m.onDragStart, e),
		emitMove: (e) => emit((m) => m.onDragMove, e),
		emitOver: (e) => emit((m) => m.onDragOver, e),
		emitEnd: (e) => emit((m) => m.onDragEnd, e),
	};
}
