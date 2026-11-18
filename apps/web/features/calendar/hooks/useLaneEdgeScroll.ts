import { effect } from "@preact/signals";
import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import { useDnd } from "@projective/ui/dnd";
import { edgeScrollVelocity } from "@ui/kanban/core/viewport.ts";

/** How deep the edge band is, in px: shallower than the board's, because a lane is short. */
const EDGE_ZONE_PX = 48;
/** The fastest the lane scrolls under a held row, px per second. */
const EDGE_MAX_SPEED = 900;

/**
 * Scroll the lane's one scroller while a row is held near its top or bottom edge (Decision #442).
 *
 * The lane used to give Routines a scroller of its own so a row dragged from far down the list could
 * still reach a routine. With one scroller for both sections, the scroller has to come to the row
 * instead: the same edge band the board uses (`edgeScrollVelocity`), on the block axis, at a rate
 * set by how far into the band the pointer is and integrated over real frame time. Each scroll asks
 * the drag to hit-test again (`resample`), because the targets moved under a pointer that did not.
 *
 * Pointer drags only: a keyboard drag steps between targets, and each target scrolls into view.
 * Must be called inside the `DndContext` the rows drag in.
 */
export function useLaneEdgeScroll(scroller: RefObject<HTMLElement>): void {
	const drag = useDnd();
	useEffect(() => {
		let frame = 0;
		let last = 0;
		let carry = 0;

		const step = (now: number) => {
			frame = 0;
			const el = scroller.current;
			const active = drag.store.active.peek();
			if (!el || !active || active.sensor !== "pointer") return;
			const dt = last ? Math.min(50, now - last) : 16;
			last = now;
			const p = drag.store.pointer.peek();
			const box = el.getBoundingClientRect();
			const v = p.x >= box.left && p.x <= box.right
				? edgeScrollVelocity(p.y, box.top, box.bottom, EDGE_ZONE_PX, EDGE_MAX_SPEED)
				: 0;
			if (v === 0) carry = 0;
			else {
				carry += (v * dt) / 1000;
				const whole = Math.trunc(carry);
				if (whole !== 0) {
					carry -= whole;
					const before = el.scrollTop;
					el.scrollTop = before + whole;
					if (el.scrollTop !== before) drag.resample();
				}
			}
			frame = requestAnimationFrame(step);
		};

		const stop = effect(() => {
			if (drag.store.active.value?.sensor === "pointer") {
				if (!frame) {
					last = 0;
					carry = 0;
					frame = requestAnimationFrame(step);
				}
			} else if (frame) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
		});
		return () => {
			stop();
			if (frame) cancelAnimationFrame(frame);
		};
	}, [drag, scroller]);
}
