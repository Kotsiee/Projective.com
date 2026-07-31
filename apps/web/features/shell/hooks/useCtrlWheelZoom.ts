import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import type { ZoomStore } from "@web/utils/zoom-store.ts";

/**
 * useCtrlWheelZoom — bind `Ctrl`+wheel (and the trackpad pinch gesture, which browsers deliver as a
 * `wheel` event with `ctrlKey` set) over a workspace element to that surface's shared zoom.
 *
 * Two details are load-bearing and were duplicated verbatim across every explorer before this hook
 * existed:
 *
 *  - the listener MUST be registered `{ passive: false }`, because a passive listener may not call
 *    `preventDefault()` and the browser would page-zoom instead of scaling the workspace;
 *  - it binds to the workspace element rather than the window, so a `Ctrl`+wheel over the lane or the
 *    footer band still does whatever the browser normally would.
 *
 * It also restores the persisted density on mount, so a body island never has to remember to call
 * {@link ZoomStore.restoreZoom} separately.
 */
export function useCtrlWheelZoom(
	ref: RefObject<HTMLElement | null>,
	store: ZoomStore,
): void {
	useEffect(() => {
		store.restoreZoom();
		const el = ref.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			store.nudgeZoom(e.deltaY < 0 ? store.ZOOM_WHEEL_STEP : -store.ZOOM_WHEEL_STEP);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
