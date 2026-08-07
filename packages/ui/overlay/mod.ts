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
export type {
	DraggablePopoverProps,
	PopoverPosition,
	PopoverSize,
} from "./islands/DraggablePopover.tsx";

/**
 * {@link MoneyFlowPopover} — the developer money-flow debugger, composed on
 * {@link DraggablePopover}. It is **fully controlled and data-driven**: wallets, legs and scope
 * arrive as props described by this package's own structural shapes, money arrives pre-formatted,
 * and the component performs no fetch and no arithmetic — it emits intent and the consuming app's
 * fat service does every calculation. That is what keeps an app-specific debugger inside a
 * copy-paste-portable package.
 */
export { MoneyFlowPopover } from "./islands/MoneyFlowPopover.island.tsx";
export type {
	FlowBalanceBucket,
	FlowBalances,
	FlowLeg,
	FlowLegKind,
	FlowMoney,
	FlowScope,
	FlowScopeKind,
	FlowSetBalanceRequest,
	FlowSimulateRequest,
	FlowStage,
	FlowWallet,
	FlowWalletRole,
	MoneyFlowPopoverProps,
} from "./islands/MoneyFlowPopover.island.tsx";
export { usePresence } from "./core/usePresence.ts";
export type { Presence, PresenceState } from "./core/usePresence.ts";

/**
 * The modal STACK — a replace-in-place router for a chain of modals. Only the top frame renders, so
 * a chain of three costs one backdrop blur rather than three, and each frame's live UI state is
 * cached (non-reactively) so popping back restores the surface a user actually left.
 */
export { bindFrameSignal, createModalStack } from "./core/modal-stack.ts";
export type { ModalFrame, ModalStack } from "./core/modal-stack.ts";
export { useFrameScroll, useFrameState } from "./hooks/useModalStack.ts";
