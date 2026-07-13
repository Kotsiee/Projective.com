/**
 * @projective/ui/utils — utility surfaces & directive-style behaviours.
 *
 * Content utilities (EmptyState, Kbd), custom-scroll surfaces (ScrollArea, ScrollTop), the ⌘K
 * CommandPalette, input-blocking (BlockUI), inline edit (Inplace), an interactive Terminal, a
 * dumb Captcha mount point, and scroll/interaction directives (FocusTrap, Defer, AnimateOnScroll,
 * Ripple). Token-only BEM; the behaviour hooks live in `@projective/ui/hooks`.
 */

// #region Content utilities
export { EmptyState } from "./components/EmptyState.tsx";
export type { EmptyStateProps } from "./components/EmptyState.tsx";
export { Kbd } from "./components/Kbd.tsx";
export type { KbdProps } from "./components/Kbd.tsx";
// #endregion

// #region Scroll surfaces
export { ScrollArea } from "./islands/ScrollArea.tsx";
export type { ScrollAreaProps, ScrollAreaType, ScrollOrientation } from "./islands/ScrollArea.tsx";
export { ScrollTop } from "./islands/ScrollTop.tsx";
export type { ScrollTopProps } from "./islands/ScrollTop.tsx";
// #endregion

// #region Command & system
export { CommandPalette } from "./islands/CommandPalette.tsx";
export type { CommandGroup, CommandPaletteProps } from "./islands/CommandPalette.tsx";
export { BlockUI } from "./islands/BlockUI.tsx";
export type { BlockUIProps } from "./islands/BlockUI.tsx";
export { Inplace } from "./islands/Inplace.tsx";
export type { InplaceProps } from "./islands/Inplace.tsx";
export { Terminal } from "./islands/Terminal.tsx";
export type { TerminalLine, TerminalProps, TerminalResult } from "./islands/Terminal.tsx";
export { Captcha } from "./islands/Captcha.tsx";
export type { CaptchaProps, CaptchaRenderContext } from "./islands/Captcha.tsx";
// #endregion

// #region Directives
export { FocusTrap } from "./islands/FocusTrap.tsx";
export type { FocusTrapProps } from "./islands/FocusTrap.tsx";
export { Defer } from "./islands/Defer.tsx";
export type { DeferProps } from "./islands/Defer.tsx";
export { AnimateOnScroll } from "./islands/AnimateOnScroll.tsx";
export type { AnimateOnScrollProps, ScrollAnimation } from "./islands/AnimateOnScroll.tsx";
export { Ripple } from "./components/Ripple.tsx";
export type { RippleProps } from "./components/Ripple.tsx";
// #endregion
