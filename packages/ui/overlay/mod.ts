/**
 * @projective/ui/overlay — layering primitives.
 *
 * The shared substrate every transient surface composes: a fixed full-viewport Portal layer, a
 * dimming Backdrop, a generic controlled Overlay (Portal + Backdrop + focus trap + dismiss +
 * z-stack), and an anchored HoverCard. Full-viewport layers render inline with `position: fixed` +
 * a z-index token (no `preact/compat`), coordinated by `@projective/ui/hooks/useOverlayStack`. The
 * one exception is {@link BodyPortal} — a real `document.body` DOM portal (still no `preact/compat`,
 * built on Preact core `render`) for anchored micro-popups that must escape a transformed ancestor's
 * re-based `position: fixed` (the glass-blur fixed-overlay trap).
 *
 * {@link DraggablePopover} builds on the same portal: a non-modal, draggable, resizable floating
 * window (a consumer supplies the content). The corner-anchored action FAB is the pre-existing
 * {@link SpeedDial} in `@projective/ui/fields` — not duplicated here.
 */
export { Portal } from "./components/Portal.tsx";
export type { PortalProps } from "./components/Portal.tsx";
export { BodyPortal } from "./components/BodyPortal.tsx";
export type { BodyPortalProps } from "./components/BodyPortal.tsx";
export { Backdrop } from "./islands/Backdrop.tsx";
export type { BackdropProps } from "./islands/Backdrop.tsx";
export { Overlay } from "./islands/Overlay.tsx";
export type { OverlayProps } from "./islands/Overlay.tsx";
export { HoverCard } from "./islands/HoverCard.tsx";
export type { HoverCardProps } from "./islands/HoverCard.tsx";
export { DraggablePopover } from "./islands/DraggablePopover.tsx";
export type { DraggablePopoverProps, PopoverPosition } from "./islands/DraggablePopover.tsx";
export { usePresence } from "./core/usePresence.ts";
export type { Presence, PresenceState } from "./core/usePresence.ts";
