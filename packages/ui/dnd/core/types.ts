/**
 * @projective/ui/dnd — shared drag-and-drop vocabulary.
 *
 * A tiny, dependency-free Pointer-Events drag model (no native HTML5 `draggable`, no external DnD
 * library — root CLAUDE.md §3 / PRODUCT_SPEC §Libraries). Every type here is transport-agnostic: the
 * hooks/components wire pointer + keyboard sensors to these shapes, and consumers (e.g. the Kanban
 * board) read them to reorder their own state on drop. Signal-first, SSR-safe.
 */

// #region Ids & payloads
/** A stable identifier for a draggable source or droppable target (unique within one context). */
export type DndId = string;

/**
 * Caller-defined payload carried on a draggable/droppable. Kept minimal and STABLE (e.g. a `type`
 * discriminator + `accepts` allow-list) — dynamic positional data (a card's column/index) is re-derived
 * from the consumer's own model by id on drop, never trusted from a possibly-stale registration.
 */
export interface DndData {
	/** A discriminator the collision detector matches against droppable `accepts` (e.g. "card"/"column"). */
	type?: string;
	/** The drag `type`s this droppable will accept; absent = accepts anything. */
	accepts?: readonly string[];
	[key: string]: unknown;
}

/** A viewport point (client coordinates). */
export interface DndPoint {
	x: number;
	y: number;
}
// #endregion

// #region Registrations
/** A registered droppable target — the collision detector hit-tests its live rect. */
export interface DndDroppable {
	id: DndId;
	data: DndData;
	disabled: boolean;
	/** The element's current bounding rect, or `null` when unmounted. */
	getRect: () => DOMRect | null;
}

/** A registered draggable source. */
export interface DndDraggable {
	id: DndId;
	data: DndData;
	getRect: () => DOMRect | null;
}

/** The live descriptor of the in-flight drag (set from pickup to drop). */
export interface DndActive {
	id: DndId;
	data: DndData;
	/** The source element's bounding rect captured at pickup (the drag ghost's start box). */
	rect: DOMRect;
	/** Which sensor started the drag. */
	sensor: DndSensor;
}

/** Which input started the drag. */
export type DndSensor = "pointer" | "keyboard";
// #endregion

// #region Events
export interface DragStartEvent {
	active: DndActive;
}
export interface DragMoveEvent {
	active: DndActive;
	/** The droppable currently under the drag, or `null`. */
	over: DndId | null;
	pointer: DndPoint;
	/** Pointer offset from the drag origin. */
	delta: DndPoint;
}
export interface DragOverEvent {
	active: DndActive;
	over: DndId | null;
	pointer: DndPoint;
}
export interface DragEndEvent {
	active: DndActive;
	over: DndId | null;
	pointer: DndPoint;
	/** True when the drag was cancelled (Escape / interrupted) rather than dropped. */
	canceled: boolean;
}

/** A set of drag lifecycle handlers a monitor (or the context itself) can subscribe. */
export interface DndMonitor {
	onDragStart?: (e: DragStartEvent) => void;
	onDragMove?: (e: DragMoveEvent) => void;
	onDragOver?: (e: DragOverEvent) => void;
	onDragEnd?: (e: DragEndEvent) => void;
}
// #endregion

// #region Collision
export interface DndCollisionArgs {
	active: DndActive;
	pointer: DndPoint;
	/** All registered droppables (the detector filters/hit-tests them). */
	droppables: DndDroppable[];
}

/** Chooses the droppable id currently under the drag, or `null` when over nothing eligible. */
export type DndCollisionDetector = (args: DndCollisionArgs) => DndId | null;
// #endregion
