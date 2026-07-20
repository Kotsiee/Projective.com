import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { useDnd } from "../core/context.ts";

/**
 * DragOverlay — the elevated drag ghost that follows the pointer while a drag is in flight. It mounts
 * through {@link BodyPortal} (a real `document.body` portal) so its `position: fixed` never re-bases
 * onto the transformed/blurred shell chrome (the glass-blur trap), and reads the store's `active`/
 * `pointer` signals so it re-renders only during a drag. The consumer supplies the ghost content
 * (typically the same card renderer, so the ghost looks like the source at rest).
 */
export interface DragOverlayProps {
	/** The ghost content — render `null` outside a drag; this component also no-ops when idle. */
	children?: ComponentChildren;
	class?: string;
}

export function DragOverlay(props: DragOverlayProps): JSX.Element | null {
	const { store } = useDnd();
	const active = store.active.value;
	if (!active || props.children == null) return null;

	const pointer = store.pointer.value;
	const origin = store.origin.value;
	const left = active.rect.left + (pointer.x - origin.x);
	const top = active.rect.top + (pointer.y - origin.y);

	return (
		<BodyPortal>
			<div
				class={cx("ui-drag-overlay", "ui-anchored", props.class)}
				aria-hidden="true"
				style={styleVars({
					"--float-left": `${left}px`,
					"--float-top": `${top}px`,
					"--float-width": `${active.rect.width}px`,
				})}
			>
				{props.children}
			</div>
		</BodyPortal>
	);
}
