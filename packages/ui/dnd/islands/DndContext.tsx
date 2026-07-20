import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/dnd.css";
import { type DndContextValue, DndCtx, type DndDragSource } from "../core/context.ts";
import { createDndStore } from "../core/store.ts";
import { defaultCollision, type DndDirection, nextInDirection } from "../core/collision.ts";
import type {
	DndActive,
	DndCollisionArgs,
	DndCollisionDetector,
	DndId,
	DndMonitor,
	DndPoint,
} from "../core/types.ts";

/**
 * DndContext — the sensor engine + shared store for one drag-and-drop region. It wires a POINTER sensor
 * (window `pointermove`/`pointerup`, a small activation threshold so a click is never a drag, and
 * capture-phase click suppression so a completed drag never fires the card's own click) and a KEYBOARD
 * sensor (Space/Enter to pick up, Arrow keys to step between targets, Enter to drop, Escape to cancel),
 * running the collision detector on every move and emitting the drag lifecycle to any subscribed
 * {@link useDndMonitor} and to the optional handler props. It renders NO DOM wrapper — it only provides
 * context — so it never perturbs the consumer's layout.
 *
 * No native HTML5 `draggable`, no external DnD dependency (root CLAUDE.md §3). Signal-first: only
 * `active`/`over`/`pointer` are reactive; registries live in plain maps. Reduced-motion is honoured by
 * the CSS layer (the ghost/settle transitions collapse); the sensor itself is motion-free.
 */
export interface DndContextProps {
	children: ComponentChildren;
	/** Override the collision strategy (default: pointer-within → closest-centre). */
	collision?: DndCollisionDetector;
	/** Pointer travel (px) before a press becomes a drag — below it the gesture stays a click. */
	activationDistance?: number;
	onDragStart?: DndMonitor["onDragStart"];
	onDragMove?: DndMonitor["onDragMove"];
	onDragOver?: DndMonitor["onDragOver"];
	onDragEnd?: DndMonitor["onDragEnd"];
}

interface PointerPending {
	source: DndDragSource;
	start: DndPoint;
	pointerId: number;
	activated: boolean;
}

const ARROW_DIRS: Record<string, DndDirection> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

export default function DndContext(props: DndContextProps): JSX.Element {
	const store = useMemo(createDndStore, []);
	// Latest handler props, read via a ref so the sensor closures never go stale without re-binding.
	const propsRef = useRef(props);
	propsRef.current = props;

	// Imperative sensor state (never triggers a re-render).
	const pointerPending = useRef<PointerPending | null>(null);
	const keyboardOn = useRef(false);
	// Tears down any in-flight sensor — invoked on unmount so a mid-drag disposal never leaves an
	// orphaned window listener or a stuck `data-dnd-dragging` attribute.
	const teardownRef = useRef<() => void>(() => {});

	const ctx = useMemo<DndContextValue>(() => {
		const win = globalThis as unknown as Window & typeof globalThis;
		const collisionOf = () => propsRef.current.collision ?? defaultCollision;
		const threshold = () => propsRef.current.activationDistance ?? 5;

		const collide = (active: DndActive, pointer: DndPoint): DndId | null => {
			const args: DndCollisionArgs = {
				active,
				pointer,
				droppables: [...store.droppables.values()],
			};
			return collisionOf()(args);
		};

		const setDragging = (on: boolean) => {
			try {
				const root = win.document?.documentElement;
				if (!root) return;
				if (on) root.setAttribute("data-dnd-dragging", "true");
				else root.removeAttribute("data-dnd-dragging");
			} catch {
				/* SSR / no DOM */
			}
		};

		const suppressNextClick = () => {
			const onClick = (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				win.removeEventListener("click", onClick, true);
			};
			win.addEventListener("click", onClick, true);
			// Safety: drop the guard on the next frame if no click follows the drop.
			win.setTimeout(() => win.removeEventListener("click", onClick, true), 0);
		};

		// #region Pointer sensor
		const onPointerMove = (e: PointerEvent) => {
			const p = pointerPending.current;
			// Ignore other pointers (multitouch) — only the pointer that armed the drag drives it.
			if (!p || e.pointerId !== p.pointerId) return;
			const point: DndPoint = { x: e.clientX, y: e.clientY };

			if (!p.activated) {
				if (Math.hypot(point.x - p.start.x, point.y - p.start.y) < threshold()) return;
				const rect = p.source.getRect();
				if (!rect) {
					teardownPointer();
					return;
				}
				const active: DndActive = { id: p.source.id, data: p.source.data, rect, sensor: "pointer" };
				p.activated = true;
				store.active.value = active;
				store.origin.value = p.start;
				store.pointer.value = point;
				const over = collide(active, point);
				store.over.value = over;
				setDragging(true);
				store.emitStart({ active });
				store.emitOver({ active, over, pointer: point });
				store.emitMove({ active, over, pointer: point, delta: { x: 0, y: 0 } });
				e.preventDefault();
				return;
			}

			const active = store.active.value;
			if (!active) return;
			store.pointer.value = point;
			const over = collide(active, point);
			const changed = over !== store.over.value;
			store.over.value = over;
			const delta = { x: point.x - store.origin.value.x, y: point.y - store.origin.value.y };
			if (changed) store.emitOver({ active, over, pointer: point });
			store.emitMove({ active, over, pointer: point, delta });
			e.preventDefault();
		};

		const onPointerUp = (e: PointerEvent) => {
			const p = pointerPending.current;
			if (!p || e.pointerId !== p.pointerId) return;
			if (p.activated) {
				const active = store.active.value;
				if (active) {
					store.emitEnd({
						active,
						over: store.over.value,
						pointer: store.pointer.value,
						canceled: false,
					});
				}
				suppressNextClick();
			}
			teardownPointer();
		};

		const onPointerKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && pointerPending.current?.activated) {
				const active = store.active.value;
				if (active) {
					store.emitEnd({
						active,
						over: store.over.value,
						pointer: store.pointer.value,
						canceled: true,
					});
				}
				teardownPointer();
			}
		};

		const teardownPointer = () => {
			win.removeEventListener("pointermove", onPointerMove);
			win.removeEventListener("pointerup", onPointerUp);
			win.removeEventListener("pointercancel", onPointerUp);
			win.removeEventListener("keydown", onPointerKey, true);
			pointerPending.current = null;
			store.active.value = null;
			store.over.value = null;
			setDragging(false);
		};

		const armPointer = (source: DndDragSource, e: PointerEvent) => {
			if (source.disabled || e.button !== 0 || store.active.value) return;
			pointerPending.current = {
				source,
				start: { x: e.clientX, y: e.clientY },
				pointerId: e.pointerId,
				activated: false,
			};
			win.addEventListener("pointermove", onPointerMove, { passive: false });
			win.addEventListener("pointerup", onPointerUp);
			win.addEventListener("pointercancel", onPointerUp);
			win.addEventListener("keydown", onPointerKey, true);
		};
		// #endregion

		// #region Keyboard sensor
		const centerOf = (rect: DOMRect): DndPoint => ({
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		});

		const onKeyboardKey = (e: KeyboardEvent) => {
			const active = store.active.value;
			if (!active) return;
			if (e.key in ARROW_DIRS) {
				e.preventDefault();
				const args: DndCollisionArgs = {
					active,
					pointer: store.pointer.value,
					droppables: [...store.droppables.values()],
				};
				const next = nextInDirection(store.over.value, ARROW_DIRS[e.key], args);
				if (next && next !== store.over.value) {
					store.over.value = next;
					const rect = store.droppables.get(next)?.getRect();
					if (rect) store.pointer.value = centerOf(rect);
					store.emitOver({ active, over: next, pointer: store.pointer.value });
					store.emitMove({
						active,
						over: next,
						pointer: store.pointer.value,
						delta: { x: 0, y: 0 },
					});
				}
			} else if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				store.emitEnd({
					active,
					over: store.over.value,
					pointer: store.pointer.value,
					canceled: false,
				});
				teardownKeyboard();
			} else if (e.key === "Escape" || e.key === "Tab") {
				e.preventDefault();
				store.emitEnd({
					active,
					over: store.over.value,
					pointer: store.pointer.value,
					canceled: true,
				});
				teardownKeyboard();
			}
		};

		const teardownKeyboard = () => {
			win.removeEventListener("keydown", onKeyboardKey, true);
			keyboardOn.current = false;
			store.active.value = null;
			store.over.value = null;
			setDragging(false);
		};

		const beginKeyboard = (source: DndDragSource) => {
			if (source.disabled || store.active.value) return;
			const rect = source.getRect();
			if (!rect) return;
			const active: DndActive = { id: source.id, data: source.data, rect, sensor: "keyboard" };
			const center = centerOf(rect);
			keyboardOn.current = true;
			store.active.value = active;
			store.origin.value = center;
			store.pointer.value = center;
			store.over.value = null;
			setDragging(true);
			store.emitStart({ active });
			win.addEventListener("keydown", onKeyboardKey, true);
		};
		// #endregion

		// Expose a combined teardown for the unmount effect (idempotent — no-op when idle).
		teardownRef.current = () => {
			teardownPointer();
			teardownKeyboard();
		};

		return {
			store,
			armPointer,
			beginKeyboard,
			keyboardActive: () => keyboardOn.current,
		};
		// The store is stable for the lifetime of this context; the closures read fresh props via refs.
	}, [store]);

	// Register the convenience handler props as a monitor (identity-stable via a ref indirection).
	const monitorRef = useRef<DndMonitor>({});
	monitorRef.current = {
		onDragStart: (e) => propsRef.current.onDragStart?.(e),
		onDragMove: (e) => propsRef.current.onDragMove?.(e),
		onDragOver: (e) => propsRef.current.onDragOver?.(e),
		onDragEnd: (e) => propsRef.current.onDragEnd?.(e),
	};
	useEffect(() => {
		const monitor: DndMonitor = {
			onDragStart: (e) => monitorRef.current.onDragStart?.(e),
			onDragMove: (e) => monitorRef.current.onDragMove?.(e),
			onDragOver: (e) => monitorRef.current.onDragOver?.(e),
			onDragEnd: (e) => monitorRef.current.onDragEnd?.(e),
		};
		store.addMonitor(monitor);
		return () => {
			store.removeMonitor(monitor);
			// Dispose any in-flight drag so a mid-drag unmount leaves no orphaned listeners / stuck state.
			teardownRef.current();
		};
	}, [store]);

	return <DndCtx.Provider value={ctx}>{props.children}</DndCtx.Provider>;
}
