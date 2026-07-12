/**
 * `useFloating` — minimal anchored positioning for popups (Select/DatePicker/Autocomplete panels).
 *
 * No third-party positioning lib (token-only, dependency-light). Measures the trigger and panel with
 * `getBoundingClientRect`, places the panel on the preferred side, and flips when it would overflow
 * the viewport. Recomputes on scroll/resize while open. Positions are written as `--float-*` custom
 * properties the panel CSS consumes (fixed positioning relative to the viewport).
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

export type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

export interface FloatingState {
	top: number;
	left: number;
	width: number;
	placement: Placement;
}

export interface UseFloatingOptions {
	open: boolean;
	triggerRef: RefObject<HTMLElement>;
	panelRef: RefObject<HTMLElement>;
	placement?: Placement;
	/** Gap between trigger and panel, px (default 4). */
	offset?: number;
	/** Match the panel width to the trigger (default true). */
	matchWidth?: boolean;
}

export function useFloating(opts: UseFloatingOptions): FloatingState | null {
	const { open, triggerRef, panelRef, placement = "bottom-start", offset = 4, matchWidth = true } =
		opts;
	const [state, setState] = useState<FloatingState | null>(null);

	const compute = useCallback(() => {
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (!trigger || typeof document === "undefined") return;
		const t = trigger.getBoundingClientRect();
		const panelH = panel?.offsetHeight ?? 0;
		const panelW = panel?.offsetWidth ?? t.width;
		const vh = globalThis.innerHeight;
		const vw = globalThis.innerWidth;

		let resolved = placement;
		const wantsTop = placement.startsWith("top");
		const spaceBelow = vh - t.bottom;
		const spaceAbove = t.top;
		// Flip vertically when the preferred side lacks room and the other has more.
		if (!wantsTop && spaceBelow < panelH + offset && spaceAbove > spaceBelow) {
			resolved = placement.replace("bottom", "top") as Placement;
		} else if (wantsTop && spaceAbove < panelH + offset && spaceBelow > spaceAbove) {
			resolved = placement.replace("top", "bottom") as Placement;
		}

		const onTop = resolved.startsWith("top");
		const alignEnd = resolved.endsWith("end");
		const top = onTop ? t.top - panelH - offset : t.bottom + offset;
		let left = alignEnd ? t.right - panelW : t.left;
		// Clamp horizontally into the viewport.
		left = Math.max(8, Math.min(left, vw - panelW - 8));

		setState({ top, left, width: matchWidth ? t.width : panelW, placement: resolved });
	}, [triggerRef, panelRef, placement, offset, matchWidth]);

	useEffect(() => {
		if (!open) {
			setState(null);
			return;
		}
		compute();
		const onScroll = () => compute();
		globalThis.addEventListener("scroll", onScroll, true);
		globalThis.addEventListener("resize", onScroll);
		return () => {
			globalThis.removeEventListener("scroll", onScroll, true);
			globalThis.removeEventListener("resize", onScroll);
		};
	}, [open, compute]);

	return state;
}
