/**
 * `useDismiss` — close an open overlay (menu/popover/dialog) on outside pointerdown or Escape.
 *
 * Client-only; listeners attach in an effect and tear down on close/unmount. Anchored overlays pass
 * both refs so a click on the trigger itself doesn't double-toggle. Escape is captured so it wins
 * over inner handlers that stop propagation.
 */
import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

export interface DismissOptions {
	open: boolean;
	onDismiss: () => void;
	/** The overlay/panel element — clicks inside are ignored. */
	panelRef: RefObject<HTMLElement>;
	/** The trigger element — clicks here are ignored (its own handler toggles). */
	triggerRef?: RefObject<HTMLElement>;
	/** Close on Escape (default true). */
	closeOnEscape?: boolean;
	/** Close on outside pointer (default true). */
	closeOnOutside?: boolean;
	/**
	 * Whether this overlay currently owns dismissal — pass `useOverlayStack().isTop` (default true).
	 *
	 * This must gate the listener itself, not just the callback. Every instance registers on `document`
	 * in the capture phase, so listeners run in registration order: an outer dialog that merely no-ops
	 * inside its own callback would still consume the Escape press and starve the inner overlay.
	 */
	enabled?: boolean;
}

export function useDismiss(opts: DismissOptions): void {
	const {
		open,
		onDismiss,
		panelRef,
		triggerRef,
		closeOnEscape = true,
		closeOnOutside = true,
		enabled = true,
	} = opts;

	useEffect(() => {
		if (!open || !enabled || typeof document === "undefined") return;

		const onPointer = (e: PointerEvent) => {
			if (!closeOnOutside) return;
			const target = e.target as Node | null;
			if (panelRef.current?.contains(target)) return;
			if (triggerRef?.current?.contains(target)) return;
			onDismiss();
		};
		const onKey = (e: KeyboardEvent) => {
			if (!closeOnEscape || e.key !== "Escape") return;
			// `stopImmediatePropagation`, not `stopPropagation`: sibling listeners on `document` itself
			// are unaffected by the latter, so one press used to close the whole stack at once.
			e.stopImmediatePropagation();
			e.preventDefault();
			onDismiss();
		};

		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [open, enabled, onDismiss, panelRef, triggerRef, closeOnEscape, closeOnOutside]);
}
