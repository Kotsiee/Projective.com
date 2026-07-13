/**
 * @projective/ui/feedback — status & transient surfaces.
 *
 * Inline status (Message, Messages, Alert/Banner), transient overlays (Toast, Dialog, DynamicDialog,
 * ConfirmDialog, ConfirmPopup, Drawer/Sidebar, Tooltip, Popover/OverlayPanel), and progress
 * indicators (ProgressBar, ProgressSpinner, ProgressRing, Spinner/Loader, Skeleton). Modal overlays
 * coordinate z-index + scroll-lock via `@projective/ui/hooks/useOverlayStack`, trap focus, and defer
 * to a bottom sheet under `--bp-md`. Token-only BEM; ARIA + reduced-motion are merge gates.
 */

// #region Inline status
export { Message } from "./components/Message.tsx";
export type { MessageProps, MessageVariant } from "./components/Message.tsx";
export { Messages } from "./islands/Messages.tsx";
export type { MessagesProps } from "./islands/Messages.tsx";
export { Alert, Banner } from "./components/Alert.tsx";
export type { AlertProps, AlertVariant } from "./components/Alert.tsx";
// #endregion

// #region Transient overlays
export { Toast, useToast } from "./islands/Toast.tsx";
export type { ToastApi, ToastProps } from "./islands/Toast.tsx";
export { Dialog } from "./islands/Dialog.tsx";
export type { DialogProps, DialogTemplateContext } from "./islands/Dialog.tsx";
export { DialogHost, useDialog } from "./islands/DynamicDialog.tsx";
export type { DialogConfig, DialogInstanceRef, DialogService } from "./islands/DynamicDialog.tsx";
export { ConfirmDialog } from "./islands/ConfirmDialog.tsx";
export type { ConfirmDialogProps } from "./islands/ConfirmDialog.tsx";
export { ConfirmPopup } from "./islands/ConfirmPopup.tsx";
export type { ConfirmPopupProps, ConfirmPopupTriggerApi } from "./islands/ConfirmPopup.tsx";
export { Drawer, Sidebar } from "./islands/Drawer.tsx";
export type { DrawerProps } from "./islands/Drawer.tsx";
export { Tooltip } from "./islands/Tooltip.tsx";
export type { TooltipProps } from "./islands/Tooltip.tsx";
export { OverlayPanel, Popover } from "./islands/Popover.tsx";
export type { PopoverProps, PopoverTriggerApi } from "./islands/Popover.tsx";
// #endregion

// #region Progress & placeholders
export { ProgressBar } from "./components/ProgressBar.tsx";
export type { ProgressBarMode, ProgressBarProps } from "./components/ProgressBar.tsx";
export { ProgressSpinner } from "./components/ProgressSpinner.tsx";
export type { ProgressSpinnerProps } from "./components/ProgressSpinner.tsx";
export { ProgressRing } from "./components/ProgressRing.tsx";
export type { ProgressRingProps } from "./components/ProgressRing.tsx";
export { Loader, Spinner } from "./components/Spinner.tsx";
export type { LoaderProps, SpinnerProps } from "./components/Spinner.tsx";
export { Skeleton } from "./components/Skeleton.tsx";
export type { SkeletonAnimation, SkeletonProps, SkeletonShape } from "./components/Skeleton.tsx";
// #endregion

// #region Shared types
export type { MessageItem, ToastMessage, ToastPosition } from "./types/mod.ts";
// #endregion
