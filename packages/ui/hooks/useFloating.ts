/**
 * `useFloating` — anchored positioning for popups (menus, popovers, tooltips, dropdowns).
 *
 * Dependency-light (token-only, no positioning lib). Measures trigger + panel with
 * `getBoundingClientRect`, places the panel on the preferred side/alignment, and flips to the
 * opposite side when the preferred one would overflow the viewport. Recomputes on scroll/resize while
 * open. Positions are written as `--float-*` custom properties the panel CSS consumes (fixed,
 * viewport-relative). This is the package-level superset of the fields-local hook: it adds the
 * `left`/`right` axes and start/end alignment across all four sides.
 *
 * Beyond viewport clamping it understands **boundaries**: `avoid` zones are higher-level layout
 * regions (the site-nav sidebar, the header) the panel must never intersect — it shifts clear of
 * them; `allowOverflow` edges are lower-level regions the panel MAY spill into (a header search
 * dropping into the body), relaxing the viewport clamp on those sides. The ergonomic, ref-owning
 * facade over this engine is {@link useEdgeDetection}.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Placement } from "../types/mod.ts";

export type { Placement };

/** A physical box side. Exposed so callers can name `allowOverflow` edges. */
export type Side = "top" | "bottom" | "left" | "right";

/**
 * A viewport-relative rectangle (all coords in CSS px from the top-left of the viewport, matching
 * `getBoundingClientRect`). Used to describe a boundary a floating panel must respect.
 */
export interface BoundaryRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/**
 * A boundary the panel must stay clear of, given as any of:
 * - a **CSS selector** — re-queried on every measure, so a sidebar that collapses/expands or a lane
 *   that is dragged wider keeps constraining the panel with its *live* rect;
 * - a **Preact ref** to the boundary element;
 * - a **static {@link BoundaryRect}**; or
 * - a **getter** returning a live rect (or `null` to skip).
 */
export type BoundarySource =
	| string
	| RefObject<HTMLElement>
	| BoundaryRect
	| (() => BoundaryRect | null);

function rectOf(el: Element): BoundaryRect {
	const r = el.getBoundingClientRect();
	return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
}

/**
 * Resolve mixed {@link BoundarySource}s to live viewport rects, dropping any that cannot be found
 * (a selector that matches nothing, a ref not yet attached, a getter returning `null`). SSR-safe:
 * returns `[]` when there is no `document`.
 */
export function resolveBoundaries(
	sources: readonly BoundarySource[] | undefined,
): BoundaryRect[] {
	if (!sources || sources.length === 0 || typeof document === "undefined") return [];
	const out: BoundaryRect[] = [];
	for (const src of sources) {
		if (typeof src === "string") {
			const el = document.querySelector(src);
			if (el) out.push(rectOf(el));
		} else if (typeof src === "function") {
			const r = src();
			if (r) out.push(r);
		} else if ("current" in src) {
			const el = src.current;
			if (el) out.push(rectOf(el));
		} else {
			out.push(src);
		}
	}
	return out;
}

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
	/** Viewport edge padding kept when clamping, and the gap kept from every `avoid` zone, px (default 8). */
	padding?: number;
	/**
	 * Higher-level layout zones the panel must never intersect (the site-nav sidebar, the header). It
	 * shifts clear of each — e.g. avoiding a left sidebar pushes the panel to the right. Selectors are
	 * re-measured on every reposition, so collapsed/expanded/dragged chrome stays honoured.
	 */
	avoid?: readonly BoundarySource[];
	/**
	 * Viewport edges the panel MAY overflow into a lower-level zone (e.g. a header search dropping into
	 * the body/middle-nav). Relaxes the clamp on those sides only; `avoid` zones still constrain.
	 */
	allowOverflow?: readonly Side[];
}

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
	avoid: readonly BoundaryRect[] = [],
	allowOverflow: readonly Side[] = [],
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

	// Resolve the box the panel is allowed to occupy. It starts as the viewport inset by `padding`;
	// each `allowOverflow` edge lifts that bound to ±Infinity (the panel may spill into the lower-level
	// zone beyond it); each `avoid` zone carves the box back so the panel clears higher-level nav.
	let minX = allowOverflow.includes("left") ? -Infinity : padding;
	let maxX = allowOverflow.includes("right") ? Infinity : viewport.width - padding;
	let minY = allowOverflow.includes("top") ? -Infinity : padding;
	let maxY = allowOverflow.includes("bottom") ? Infinity : viewport.height - padding;

	// Push away from each avoided zone on the side the trigger sits on: a left sidebar (trigger to its
	// right) lifts `minX` to the zone's right edge → the panel shifts right to clear it; a header above
	// lifts `minY`; symmetric on the other sides. A zone that straddles the trigger defaults to a
	// rightward shift (the sidebar case).
	const cx = trigger.left + trigger.width / 2;
	const cy = trigger.top + trigger.height / 2;
	for (const zone of avoid) {
		if (cx >= zone.right) minX = Math.max(minX, zone.right + padding);
		else if (cx <= zone.left) maxX = Math.min(maxX, zone.left - padding);
		else if (cy >= zone.bottom) minY = Math.max(minY, zone.bottom + padding);
		else if (cy <= zone.top) maxY = Math.min(maxY, zone.top - padding);
		else minX = Math.max(minX, zone.right + padding);
	}

	// Clamp into the resolved box. Higher-level nav wins over the viewport edge: when the panel is wider
	// than the cleared space, the near edge stays pinned clear (the `min`) rather than sliding back
	// under the nav — `Math.max(min, …)` resolves last.
	left = Math.max(minX, Math.min(left, maxX - panelW));
	top = Math.max(minY, Math.min(top, maxY - panelH));

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
		avoid,
		allowOverflow,
	} = opts;
	const [state, setState] = useState<FloatingState | null>(null);

	// Stable dependency keys so an inline `avoid`/`allowOverflow` array literal (new identity each
	// render) does not re-create `compute` — the boundary rects are re-resolved live inside it anyway.
	const avoidKey = (avoid ?? []).map((a) => (typeof a === "string" ? a : " ")).join("|");
	const overflowKey = (allowOverflow ?? []).join("|");

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
				{ width: globalThis.innerWidth, height: globalThis.innerHeight },
				placement,
				offset,
				padding,
				resolveBoundaries(avoid),
				allowOverflow ?? [],
			),
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [triggerRef, panelRef, placement, offset, matchWidth, padding, avoidKey, overflowKey]);

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
