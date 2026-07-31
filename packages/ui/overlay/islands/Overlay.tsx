import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/overlay.css";
import { cx } from "../../core/cx.ts";
import { Portal } from "../components/Portal.tsx";
import { Backdrop } from "./Backdrop.tsx";
import { usePresence } from "../core/usePresence.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** Props for {@link Overlay}. */
export interface OverlayProps {
	/** Open state — raw boolean (uncontrolled) or a `Signal<boolean>` (controlled). */
	open: Bindable<boolean>;
	/** Render a dimming backdrop, lock scroll, and trap focus (default `true`). */
	modal?: boolean;
	/** Allow outside-pointer dismissal (default `true`). */
	dismissable?: boolean;
	/** Close on Escape when top-most (default `true`). */
	closeOnEscape?: boolean;
	/** Lock body scroll while open. Defaults to `modal`. */
	lockScroll?: boolean;
	/** Fired whenever the open state changes (open or close). */
	onOpenChange?: (open: boolean) => void;
	/** Extra class(es) merged onto the content wrapper. */
	class?: string;
	/** Overlay contents (an unpositioned wrapper — children own their own layout/positioning). */
	children?: ComponentChildren;
}
// #endregion

/**
 * Overlay — the base controlled layering primitive the feedback surfaces compose. It wires a
 * {@link Portal} layer, an optional {@link Backdrop}, the managed z-index + scroll-lock
 * ({@link useOverlayStack}), focus containment ({@link useFocusTrap}), and outside/Escape dismissal
 * ({@link useDismiss}, gated to the top-most overlay). Enter/exit presence is handled so the wrapper
 * animates out before unmounting. Children supply their own panel and positioning.
 */
export function Overlay(props: OverlayProps): JSX.Element | null {
	const {
		open,
		modal = true,
		dismissable = true,
		closeOnEscape = true,
		lockScroll,
		onOpenChange,
		class: className,
		children,
	} = props;

	const ctrl = useControllable<boolean>(open, false, onOpenChange);
	const isOpen = ctrl.signal.value;
	const { mounted, state } = usePresence(isOpen);

	const contentRef = useRef<HTMLDivElement>(null);
	// A modal Overlay draws a backdrop, locks scroll and traps focus, so it belongs to the modal band —
	// defaulting to `popover` let it allocate from 1100 and lose to any Dialog.
	const stack = useOverlayStack({
		active: mounted,
		lockScroll: lockScroll ?? modal,
		layer: modal ? "modal" : "popover",
	});

	const close = () => ctrl.set(false);

	useFocusTrap({ active: mounted && modal, containerRef: contentRef, inertBackground: modal });
	useDismiss({
		open: mounted,
		enabled: stack.isTop,
		onDismiss: close,
		panelRef: contentRef,
		closeOnEscape,
		// A modal Overlay dismisses through the backdrop's own click, exactly like Dialog and Drawer.
		// Wiring outside-pointerdown as well fired the same close twice for one press.
		closeOnOutside: dismissable && !modal,
	});

	if (!mounted) return null;

	return (
		<Portal zIndex={stack.zIndex}>
			{modal && <Backdrop visible={state === "open"} onClick={dismissable ? close : undefined} />}
			<div
				ref={contentRef}
				class={cx("ui-overlay__content", className)}
				data-state={state}
				tabIndex={-1}
			>
				{children}
			</div>
		</Portal>
	);
}
