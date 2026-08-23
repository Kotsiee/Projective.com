/**
 * `useEdgeDetection` (alias `usePopoverPosition`) — the ergonomic, ref-owning facade for anchored,
 * collision-aware overlays (dropdowns, popovers, menus, comboboxes).
 *
 * Where {@link useFloating} is the ref-consuming engine used by the packaged `Popover`/`Tooltip`,
 * this hook is the self-contained one a feature reaches for to hand-roll a dropdown: it OWNS the two
 * refs, measures both boxes, and returns a ready-to-spread `style`. Positioning strategy is
 * viewport-relative `position: fixed` (via the `--float-*` custom properties + the `.ui-anchored`
 * primitive class), so `overflow: hidden`/`clip` on any ancestor never truncates the panel.
 *
 * It resolves collisions in three layers:
 *  1. **Viewport flip/clamp** — the preferred `placement` flips to the opposite side when it lacks
 *     room; the panel is then clamped inside the viewport (minus `padding`) so it never leaves screen.
 *  2. **Higher-level nav avoidance** (`avoid`) — a hard constraint. Zones such as the primary site
 *     sidebar or the header are never intersected; the panel shifts away from them (a left sidebar
 *     pushes it right). Selectors are re-measured on every reposition, so collapsing/expanding chrome
 *     is always honoured.
 *  3. **Lower-level allowed overflow** (`allowOverflow`) — the panel MAY spill past the viewport edge
 *     on the named sides into lower-level regions (e.g. a header search dropping down into the body).
 *
 * Signal-agnostic and SSR-safe: before the first client measure `ready` is `false` and the panel is
 * parked off-screen by the `.ui-anchored` fallbacks, so there is no first-paint flash.
 *
 * @example
 * ```tsx
 * const pos = useEdgeDetection({ open: open.value, placement: "bottom-end",
 *   avoid: [".ui-app-shell__sidebar"], allowOverflow: ["bottom"] });
 * return (
 *   <>
 *     <button ref={pos.triggerRef} onClick={() => (open.value = !open.value)}>Filters</button>
 *     {open.value && <div ref={pos.ref} class="ui-anchored" style={pos.style}>…</div>}
 *   </>
 * );
 * ```
 */
import { useCallback, useRef } from "preact/hooks";
import type { CSSProperties, RefObject } from "preact";
import { styleVars } from "../core/style.ts";
import { useFloating } from "./useFloating.ts";
import type { BoundarySource, Placement, Side } from "./useFloating.ts";

export type { BoundaryRect, BoundarySource, Side } from "./useFloating.ts";
export type { Placement };

// #region Options / result
export interface UseEdgeDetectionOptions {
	/** Whether the panel is currently rendered/open — positioning only runs while `true`. */
	open: boolean;
	/** Preferred side/alignment; flips on overflow (default `bottom-start`). */
	placement?: Placement;
	/** Gap between trigger and panel, px (default 4). */
	offset?: number;
	/** Gap kept from each `avoid` zone, px (default 8). Also the default for `collisionPadding`. */
	padding?: number;
	/** Inset kept from the VIEWPORT edges when clamping, px (defaults to `padding`). */
	collisionPadding?: number;
	/** Match the panel width to the trigger — exposed as `--float-width` (default false). */
	matchWidth?: boolean;
	/** Higher-level nav zones the panel must never intersect — it shifts clear (see the module doc). */
	avoid?: readonly BoundarySource[];
	/** Viewport edges the panel may overflow into lower-level zones (relaxes the clamp there). */
	allowOverflow?: readonly Side[];
	/** Stacking index, written as `--z-portal` (defaults to the `--z-overlay` token via `.ui-anchored`). */
	zIndex?: number;
}

export interface EdgeDetection<
	Trigger extends HTMLElement = HTMLElement,
	Panel extends HTMLElement = HTMLElement,
> {
	/** Attach to the trigger/anchor element the panel is positioned against. */
	triggerRef: RefObject<Trigger>;
	/** Attach to the floating panel element (pair with `class="ui-anchored"`). */
	ref: RefObject<Panel>;
	/** Spread onto the panel — the resolved `--float-*` / `--z-portal` custom properties. */
	style: CSSProperties;
	/** The side/alignment actually used after flipping (for arrow direction or a `data-*` hook). */
	placement: Placement;
	/** Resolved viewport-relative left/top in px, or `null` before the first measure. */
	x: number | null;
	y: number | null;
	/** `false` until the first client measure completes (panel parked off-screen until then). */
	ready: boolean;
	/** Force a reposition (e.g. after the panel's own content grows). */
	recompute: () => void;
}
// #endregion

/**
 * Anchored, collision- and nav-aware positioning that owns its refs. See the module doc for the
 * three-layer collision model and a usage example.
 */
export function useEdgeDetection<
	Trigger extends HTMLElement = HTMLElement,
	Panel extends HTMLElement = HTMLElement,
>(opts: UseEdgeDetectionOptions): EdgeDetection<Trigger, Panel> {
	const triggerRef = useRef<Trigger>(null);
	const panelRef = useRef<Panel>(null);

	const floating = useFloating({
		open: opts.open,
		triggerRef: triggerRef as RefObject<HTMLElement>,
		panelRef: panelRef as RefObject<HTMLElement>,
		placement: opts.placement ?? "bottom-start",
		offset: opts.offset,
		padding: opts.padding,
		matchWidth: opts.matchWidth,
		collisionPadding: opts.collisionPadding,
		avoid: opts.avoid,
		allowOverflow: opts.allowOverflow,
	});

	const style = styleVars({
		"--float-top": floating ? `${floating.top}px` : undefined,
		"--float-left": floating ? `${floating.left}px` : undefined,
		"--float-width": floating && opts.matchWidth ? `${floating.width}px` : undefined,
		// The space the panel actually has. A panel that can outgrow the viewport should cap itself
		// with `max-block-size: var(--float-available-h, none)` and scroll internally — clamping alone
		// only moves a too-tall panel, it cannot make it fit.
		"--float-available-h": floating?.availableHeight != null
			? `${floating.availableHeight}px`
			: undefined,
		"--float-available-w": floating?.availableWidth != null
			? `${floating.availableWidth}px`
			: undefined,
		"--z-portal": opts.zIndex !== undefined ? String(opts.zIndex) : undefined,
	});

	// A resize event drives `useFloating`'s live listener → a fresh measure (panel content may have
	// grown since open). Guarded for SSR.
	const recompute = useCallback(() => {
		if (typeof globalThis.dispatchEvent === "function") {
			globalThis.dispatchEvent(new Event("resize"));
		}
	}, []);

	return {
		triggerRef,
		ref: panelRef,
		style,
		placement: floating?.placement ?? opts.placement ?? "bottom-start",
		x: floating?.left ?? null,
		y: floating?.top ?? null,
		ready: floating !== null,
		recompute,
	};
}

/** PrimeReact-parity / intent-revealing alias for {@link useEdgeDetection}. */
export const usePopoverPosition = useEdgeDetection;
