import { useEffect, useRef } from "preact/hooks";
import { useDnd } from "../core/context.ts";
import type { DndMonitor } from "../core/types.ts";

/**
 * useDndMonitor — subscribe to the drag lifecycle of the enclosing {@link DndContext} from a component
 * INSIDE the provider (so the handlers may read the store / registered rects). The handler object may
 * change every render without re-binding — a ref indirection keeps the subscription identity-stable.
 * This is how a board reacts to drags (compute the drop target, commit the reorder on end).
 */
export function useDndMonitor(monitor: DndMonitor): void {
	const ctx = useDnd();
	const ref = useRef<DndMonitor>(monitor);
	ref.current = monitor;

	useEffect(() => {
		const stable: DndMonitor = {
			onDragStart: (e) => ref.current.onDragStart?.(e),
			onDragMove: (e) => ref.current.onDragMove?.(e),
			onDragOver: (e) => ref.current.onDragOver?.(e),
			onDragEnd: (e) => ref.current.onDragEnd?.(e),
		};
		ctx.store.addMonitor(stable);
		return () => ctx.store.removeMonitor(stable);
	}, [ctx]);
}
