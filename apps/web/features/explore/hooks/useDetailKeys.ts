import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { isEditableTarget } from "@features/shell/core/shortcuts.ts";
import { detailKeyIntent } from "../core/detail-nav.ts";
import { motionReduced } from "../core/view-transition.ts";

/** What the drawer does for each key the {@link useDetailKeys} listener claims. */
export interface DetailKeyActions {
	/** Move `delta` items through the reading order (±1, or ±5 with Shift). */
	step(delta: number): void;
	/** Move to the next or previous entity section (Ctrl / Cmd + arrow). */
	section(dir: -1 | 1): void;
	/** Open the item's full page (Enter). */
	open(): void;
}

export interface DetailKeysOptions {
	/** Whether the drawer is open; the listener exists only while it is. */
	active: boolean;
	/** The drawer panel's class — a key counts only when its target is inside the panel. */
	panelClass: string;
	/** The reading region inside the drawer body; its scroller is what ↑ / ↓ move. */
	regionRef: RefObject<HTMLElement>;
	actions: DetailKeyActions;
}

/** Elements whose own Enter is the action — the drawer must not also navigate. */
const ACTIVATABLE =
	"a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [role='menuitem'], [role='option'], [role='tab'], [role='checkbox'], [role='switch']";

/** Widgets that own the arrow keys themselves. */
const ARROW_OWNERS =
	"[role='slider'], [role='tablist'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='grid'], [role='tree']";

/** The share of the scroller's height one ↑ / ↓ press moves. */
const SCROLL_FRACTION = 0.2;

/**
 * useDetailKeys — the Search Results drawer's keyboard: ←/→ step, Shift skips five, Ctrl/Cmd changes
 * entity section, ↑/↓ scroll the body, Enter opens the full page (see {@link detailKeyIntent}). One
 * document listener while the drawer is open, removed when it closes or unmounts. A key typed into a
 * field, or pressed in a widget that owns the arrows, is left alone; Escape stays the Drawer's own.
 */
export function useDetailKeys({ active, panelClass, regionRef, actions }: DetailKeysOptions): void {
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	useEffect(() => {
		if (!active) return;

		function onKey(e: KeyboardEvent): void {
			if (e.defaultPrevented || e.isComposing) return;
			const target = e.target instanceof Element ? e.target : null;
			if (!target?.closest(`.${panelClass}`) || isEditableTarget(target)) return;
			if (target.closest(ARROW_OWNERS)) return;
			const intent = detailKeyIntent(e, document.documentElement.dir === "rtl" ? "rtl" : "ltr");
			if (!intent) return;
			if (intent.kind === "open" && (e.repeat || target.closest(ACTIVATABLE))) return;
			e.preventDefault();
			switch (intent.kind) {
				case "step":
					actionsRef.current.step(intent.delta);
					break;
				case "section":
					actionsRef.current.section(intent.dir);
					break;
				case "scroll":
					scrollRegion(regionRef.current, intent.dir);
					break;
				case "open":
					actionsRef.current.open();
					break;
			}
		}

		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [active, panelClass]);
}

function scrollRegion(region: HTMLElement | null, dir: -1 | 1): void {
	const scroller = region?.closest<HTMLElement>(".ui-drawer__body");
	if (!scroller) return;
	scroller.scrollBy({
		top: dir * Math.round(scroller.clientHeight * SCROLL_FRACTION),
		behavior: motionReduced() ? "auto" : "smooth",
	});
}
