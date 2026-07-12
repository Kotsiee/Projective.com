/**
 * `useDismiss` — close an open overlay (dropdown/popup/menu) on outside pointerdown or Escape.
 *
 * Client-only; the listeners are attached in an effect and torn down on close/unmount. Overlays that
 * anchor a trigger pass both refs so a click on the trigger itself does not double-toggle. Escape is
 * captured so it wins over any inner handler that might stop propagation.
 */
import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

export interface DismissOptions {
	/** Whether the overlay is currently open (listeners only run while true). */
	open: boolean;
	/** Called to request close. */
	onDismiss: () => void;
	/** The overlay/panel element — clicks inside are ignored. */
	panelRef: RefObject<HTMLElement>;
	/** The trigger element — clicks here are ignored (its own handler toggles). */
	triggerRef?: RefObject<HTMLElement>;
	/** Close on Escape (default true). */
	closeOnEscape?: boolean;
	/** Close on outside pointer (default true). */
	closeOnOutside?: boolean;
}

export function useDismiss(opts: DismissOptions): void {
	const { open, onDismiss, panelRef, triggerRef, closeOnEscape = true, closeOnOutside = true } =
		opts;

	useEffect(() => {
		if (!open || typeof document === "undefined") return;

		const onPointer = (e: PointerEvent) => {
			if (!closeOnOutside) return;
			const target = e.target as Node | null;
			if (panelRef.current?.contains(target)) return;
			if (triggerRef?.current?.contains(target)) return;
			onDismiss();
		};
		const onKey = (e: KeyboardEvent) => {
			if (closeOnEscape && e.key === "Escape") {
				e.stopPropagation();
				onDismiss();
			}
		};

		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [open, onDismiss, panelRef, triggerRef, closeOnEscape, closeOnOutside]);
}
