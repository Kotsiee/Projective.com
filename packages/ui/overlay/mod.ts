/**
 * @projective/ui/overlay — layering primitives.
 *
 * The shared substrate every transient surface composes: a fixed full-viewport Portal layer, a
 * dimming Backdrop, a generic controlled Overlay (Portal + Backdrop + focus trap + dismiss +
 * z-stack), and an anchored HoverCard. No `preact/compat` DOM portals — layers render inline with
 * `position: fixed` + a z-index token, coordinated by `@projective/ui/hooks/useOverlayStack`.
 */
export { Portal } from "./components/Portal.tsx";
export type { PortalProps } from "./components/Portal.tsx";
export { Backdrop } from "./islands/Backdrop.tsx";
export type { BackdropProps } from "./islands/Backdrop.tsx";
export { Overlay } from "./islands/Overlay.tsx";
export type { OverlayProps } from "./islands/Overlay.tsx";
export { HoverCard } from "./islands/HoverCard.tsx";
export type { HoverCardProps } from "./islands/HoverCard.tsx";
export { usePresence } from "./core/usePresence.ts";
export type { Presence, PresenceState } from "./core/usePresence.ts";
