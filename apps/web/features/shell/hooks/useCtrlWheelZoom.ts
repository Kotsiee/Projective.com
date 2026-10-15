import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import type { ZoomStore } from "@web/utils/zoom-store.ts";

/**
 * useCtrlWheelZoom — bind `Ctrl`/`Cmd`+wheel (and the trackpad pinch gesture, which browsers deliver
 * as a `wheel` event with `ctrlKey` set) to a surface's shared zoom, anywhere over the page's active
 * content viewport (Decision #223).
 *
 * One `{ passive: false }` listener on `document` serves every mounted surface, so it can
 * `preventDefault()` the browser's page zoom. A gesture resolves to:
 *
 *  1. the innermost registered element containing it (a ticket tab inside a dialog keeps its zoom);
 *  2. otherwise, inside `.ui-app-shell__content` but outside the main nav, the top bar, the
 *     middle-nav lane and the docked panel, the most recently mounted surface on the page.
 *
 * A component that already handled the gesture (`defaultPrevented` — a canvas viewer, the Gantt) is
 * left alone. A mouse notch eases; a pinch, already continuous, lands at once.
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
		const entry: ZoomRegistration = { ref, store };
		registrations.push(entry);
		bindDocument();
		return () => {
			const at = registrations.indexOf(entry);
			if (at >= 0) registrations.splice(at, 1);
			if (registrations.length === 0) unbindDocument();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}

interface ZoomRegistration {
	ref: RefObject<HTMLElement | null>;
	store: ZoomStore;
}

const CONTENT_REGION = ".ui-app-shell__content";
const NAV_REGIONS = [
	".ui-app-shell__sidebar",
	".ui-shell-topbar",
	".ui-middle-nav__lane",
	".ui-middle-nav__panel",
].join(", ");

const PIXELS_PER_NOTCH = 100;
const PIXELS_PER_LINE = 33;
const PIXELS_PER_PAGE = 800;
const MAX_NOTCHES_PER_EVENT = 2;
const PINCH_PIXEL_LIMIT = 50;

const registrations: ZoomRegistration[] = [];
let bound = false;

function bindDocument(): void {
	if (bound || typeof document === "undefined") return;
	document.addEventListener("wheel", onWheel, { passive: false });
	bound = true;
}

function unbindDocument(): void {
	if (!bound) return;
	document.removeEventListener("wheel", onWheel);
	bound = false;
}

function resolveStore(target: Element): ZoomStore | null {
	let owner: ZoomRegistration | null = null;
	for (const entry of registrations) {
		const el = entry.ref.current;
		if (!el || !el.contains(target)) continue;
		if (!owner || owner.ref.current?.contains(el)) owner = entry;
	}
	if (owner) return owner.store;
	if (!target.closest(CONTENT_REGION) || target.closest(NAV_REGIONS)) return null;
	for (let i = registrations.length - 1; i >= 0; i--) {
		const el = registrations[i].ref.current;
		if (el?.isConnected && el.closest(CONTENT_REGION)) return registrations[i].store;
	}
	return null;
}

function wheelPixels(e: WheelEvent): number {
	if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * PIXELS_PER_LINE;
	if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * PIXELS_PER_PAGE;
	return e.deltaY;
}

function onWheel(e: WheelEvent): void {
	if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented || e.deltaY === 0) return;
	if (!(e.target instanceof Element)) return;
	const store = resolveStore(e.target);
	if (!store) return;
	e.preventDefault();
	const pixels = wheelPixels(e);
	const notches = Math.max(
		-MAX_NOTCHES_PER_EVENT,
		Math.min(MAX_NOTCHES_PER_EVENT, -pixels / PIXELS_PER_NOTCH),
	);
	const pinch = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(pixels) < PINCH_PIXEL_LIMIT;
	store.nudgeZoom(notches * store.ZOOM_WHEEL_STEP, pinch ? "instant" : "animate");
}
