/**
 * `useFloating` — anchored positioning for popups (menus, popovers, tooltips, dropdowns).
 *
 * Dependency-light (token-only, no positioning lib). Measures trigger + panel with
 * `getBoundingClientRect`, places the panel on the preferred side/alignment, and flips to the
 * opposite side when the preferred one would overflow the viewport. Recomputes on scroll/resize while
 * open. Positions are written as `--float-*` custom properties the panel CSS consumes (fixed,
 * viewport-relative). This is the package-level superset of the fields-local hook: it adds the
 * `left`/`right` axes and start/end alignment across all four sides.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Placement } from "../types/mod.ts";

export type { Placement };

export interface FloatingState {
	top: number;
	left: number;
	/** Trigger inline size, exposed so panels may match width when asked. */
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
	/** Match the panel width to the trigger (default false for menus/popovers). */
	matchWidth?: boolean;
	/** Viewport edge padding kept when clamping, px (default 8). */
	padding?: number;
}

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

function parse(p: Placement): { side: Side; align: Align } {
	const [side, align] = p.split("-") as [Side, Align | undefined];
	return { side, align: align ?? "center" };
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Compute a floating panel position relative to a trigger. Pure geometry so it is easy to reason
 * about and unit-test; the hook wires it to scroll/resize listeners.
 */
export function computePosition(
	trigger: DOMRect,
	panelW: number,
	panelH: number,
	viewport: { width: number; height: number },
	placement: Placement,
	offset: number,
	padding: number,
): FloatingState {
	let { side, align } = parse(placement);

	// Flip the primary side when it lacks room and the opposite side has more.
	const room: Record<Side, number> = {
		top: trigger.top,
		bottom: viewport.height - trigger.bottom,
		left: trigger.left,
		right: viewport.width - trigger.right,
	};
	const need = side === "top" || side === "bottom" ? panelH + offset : panelW + offset;
	if (room[side] < need && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];

	let top: number;
	let left: number;
	if (side === "top" || side === "bottom") {
		top = side === "top" ? trigger.top - panelH - offset : trigger.bottom + offset;
		left = align === "start"
			? trigger.left
			: align === "end"
			? trigger.right - panelW
			: trigger.left + (trigger.width - panelW) / 2;
	} else {
		left = side === "left" ? trigger.left - panelW - offset : trigger.right + offset;
		top = align === "start"
			? trigger.top
			: align === "end"
			? trigger.bottom - panelH
			: trigger.top + (trigger.height - panelH) / 2;
	}

	// Clamp into the viewport so a panel never renders off-screen.
	left = Math.max(padding, Math.min(left, viewport.width - panelW - padding));
	top = Math.max(padding, Math.min(top, viewport.height - panelH - padding));

	const resolved = (align === "center" ? side : `${side}-${align}`) as Placement;
	return { top, left, width: trigger.width, placement: resolved };
}

export function useFloating(opts: UseFloatingOptions): FloatingState | null {
	const {
		open,
		triggerRef,
		panelRef,
		placement = "bottom-start",
		offset = 4,
		matchWidth = false,
		padding = 8,
	} = opts;
	const [state, setState] = useState<FloatingState | null>(null);

	const compute = useCallback(() => {
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (!trigger || typeof window === "undefined") return;
		const t = trigger.getBoundingClientRect();
		const panelH = panel?.offsetHeight ?? 0;
		const panelW = matchWidth ? t.width : (panel?.offsetWidth ?? t.width);
		setState(
			computePosition(
				t,
				panelW,
				panelH,
				{ width: window.innerWidth, height: window.innerHeight },
				placement,
				offset,
				padding,
			),
		);
	}, [triggerRef, panelRef, placement, offset, matchWidth, padding]);

	useEffect(() => {
		if (!open) {
			setState(null);
			return;
		}
		compute();
		const onScroll = () => compute();
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [open, compute]);

	return state;
}
