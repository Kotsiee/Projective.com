/**
 * @projective/ui/hooks — package-level cross-cutting behaviour hooks.
 *
 * These power more than one taxonomy (overlays, menus, collections, scroll utilities), so they live
 * at the package root rather than inside a single sub-package. Field-specific hooks stay under
 * `fields/hooks`; the value-binding, id, and list-navigation hooks are re-exported here so every
 * taxonomy shares one import path. All are signal-first and SSR-safe (client behaviour attaches in
 * effects).
 */
export { computePosition, resolveBoundaries, useFloating } from "./useFloating.ts";
export type {
	BoundaryRect,
	BoundarySource,
	FloatingState,
	Placement,
	Side,
	UseFloatingOptions,
} from "./useFloating.ts";
export { useEdgeDetection, usePopoverPosition } from "./useEdgeDetection.ts";
export type { EdgeDetection, UseEdgeDetectionOptions } from "./useEdgeDetection.ts";
export { useDismiss } from "./useDismiss.ts";
export type { DismissOptions } from "./useDismiss.ts";
export { getTabbable, useFocusTrap } from "./useFocusTrap.ts";
export type { FocusTrapOptions } from "./useFocusTrap.ts";
export { useOverlayStack } from "./useOverlayStack.ts";
export type { OverlayLayer, OverlayStackOptions, OverlayStackState } from "./useOverlayStack.ts";
export { useVirtualScroll } from "./useVirtualScroll.ts";
export type {
	UseVirtualScrollOptions,
	UseVirtualScrollResult,
	VirtualItem,
} from "./useVirtualScroll.ts";
export { useIntersectionObserver } from "./useIntersectionObserver.ts";
export type { IntersectionOptions, IntersectionResult } from "./useIntersectionObserver.ts";
export { useIsMobile, useMediaQuery } from "./useMediaQuery.ts";
export { useRipple } from "./useRipple.ts";
export type { RippleOptions } from "./useRipple.ts";
export { useControllable } from "./useControllable.ts";
export type { Controllable } from "./useControllable.ts";
export { useId } from "./useId.ts";
export { useListNavigation } from "./useListNavigation.ts";
export type { ListNavigation } from "./useListNavigation.ts";
