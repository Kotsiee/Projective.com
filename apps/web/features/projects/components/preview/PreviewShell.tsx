import type { ComponentChildren, JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, type PresenceState } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { KEY_SCOPE_ATTRIBUTE } from "@features/inspector/components/embed/mod.ts";

/** Props for {@link PreviewShell}. */
export interface PreviewShellProps {
	state: PresenceState;
	/** A frame of a modal stack renders its scrim at full strength from the first paint. */
	framed: boolean;
	/** The id of the element naming the dialog. */
	labelledBy: string;
	/** Escape and a press on the scrim; each dismisses exactly this one layer. */
	onDismiss: () => void;
	/** Where focus enters (a scope: its first tabbable is used). */
	initialFocusRef: RefObject<HTMLElement>;
	/** Return focus here on close instead of the control that opened the preview. */
	returnFocusTo?: HTMLElement | null;
	children: ComponentChildren;
}

/**
 * The preview's overlay: body-portalled root on the modal layer (its z-index through `--fx-z`), one
 * scrim, and the dialog panel with the focus trap and the Escape layer. The panel is the inspector's
 * key scope, so a canvas's Ctrl+F also answers while focus is in the side panel.
 */
export function PreviewShell(props: PreviewShellProps): JSX.Element {
	const { state, framed, labelledBy, onDismiss, initialFocusRef, returnFocusTo, children } = props;
	const panelRef = useRef<HTMLDivElement>(null);
	const returnTo = useRef<HTMLElement | null>(returnFocusTo ?? null);
	returnTo.current = returnFocusTo ?? null;

	const stack = useOverlayStack({ active: true, lockScroll: true, layer: "modal" });
	useFocusTrap({
		active: true,
		containerRef: panelRef,
		initialFocusRef,
		restoreFocus: returnFocusTo == null,
	});
	useDismiss({
		open: true,
		enabled: stack.isTop,
		onDismiss,
		panelRef,
		closeOnOutside: false,
	});

	// #region Focus return
	useEffect(() => () => {
		const target = returnTo.current;
		if (!target) return;
		setTimeout(() => {
			const active = document.activeElement;
			if (active && active !== document.body && active.isConnected) return;
			if (target.isConnected) target.focus({ preventScroll: true });
		}, 0);
	}, []);
	// #endregion

	return (
		<BodyPortal>
			<div
				class="fx-modal"
				data-state={state}
				style={{ "--fx-z": String(stack.zIndex) }}
			>
				<Backdrop
					class="fx-modal__scrim"
					visible={framed || state === "open"}
					onClick={onDismiss}
				/>
				<div
					ref={panelRef}
					class="fx-modal__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-labelledby={labelledBy}
					tabIndex={-1}
					{...{ [KEY_SCOPE_ATTRIBUTE]: "" }}
				>
					{children}
				</div>
			</div>
		</BodyPortal>
	);
}
