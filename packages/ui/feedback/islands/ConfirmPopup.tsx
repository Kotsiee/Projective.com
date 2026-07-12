import type { JSX, RefObject, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/confirm.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Portal } from "../../overlay/components/Portal.tsx";
import { Button } from "../../fields/components/Button.tsx";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useId } from "../../hooks/useId.ts";
import type { Placement } from "../../types/mod.ts";
import type { Bindable, Severity } from "../../fields/types/mod.ts";

// #region Props
/** Imperative handle passed to the {@link ConfirmPopupProps.trigger} render-prop. */
export interface ConfirmPopupTriggerApi {
	/** Attach to the trigger element so the popup can anchor to it. */
	ref: RefObject<HTMLElement>;
	/** Toggle the confirm popup. */
	toggle: () => void;
	/** Current open state (wire to `aria-expanded`). */
	expanded: boolean;
	/** Id of the popup surface (wire to `aria-controls`). */
	panelId: string;
}

/** Props for {@link ConfirmPopup}. */
export interface ConfirmPopupProps {
	/** Controlled/uncontrolled open state. */
	visible?: Bindable<boolean>;
	/** Render-prop for the trigger; receives {@link ConfirmPopupTriggerApi}. */
	trigger?: (api: ConfirmPopupTriggerApi) => VNode;
	/** Anchor an external element instead of a render-prop trigger; clicking it toggles the popup. */
	targetRef?: RefObject<HTMLElement>;
	/** The confirmation prompt. */
	message: string | VNode;
	/** Optional leading icon/glyph node. */
	icon?: VNode;
	/** Accept button label (default `"Yes"`). */
	acceptLabel?: string;
	/** Reject button label (default `"No"`). */
	rejectLabel?: string;
	/** Severity of the accept button (default `"primary"`). */
	acceptSeverity?: Severity;
	/** Preferred side/alignment; flips on overflow (default `bottom`). */
	placement?: Placement;
	/** Invoked when the user accepts. */
	onAccept?: () => void;
	/** Invoked when the user rejects or dismisses. */
	onReject?: () => void;
	/** Fired whenever visibility changes. */
	onVisibleChange?: (visible: boolean) => void;
	/** Extra class(es) merged onto the popup surface. */
	class?: string;
}
// #endregion

/**
 * ConfirmPopup — a compact confirmation anchored to its trigger (the popover-scale sibling of
 * {@link ConfirmDialog}). Positioned by {@link useFloating} (flips on overflow), focus-managed by
 * {@link useFocusTrap}, and dismissed on outside-pointer/Escape ({@link useDismiss}, top-most only).
 * `role="alertdialog"` with the message as its accessible description; accept/reject close it and fire
 * the matching callback. Presence animates the exit; motion collapses under reduced-motion.
 */
export function ConfirmPopup(props: ConfirmPopupProps): JSX.Element {
	const {
		visible,
		trigger,
		targetRef,
		message,
		icon,
		acceptLabel = "Yes",
		rejectLabel = "No",
		acceptSeverity = "primary",
		placement = "bottom",
		onAccept,
		onReject,
		onVisibleChange,
		class: className,
	} = props;

	const ctrl = useControllable<boolean>(visible, false, onVisibleChange);
	const isOpen = ctrl.signal.value;
	const { mounted, state } = usePresence(isOpen, 150);

	const localTriggerRef = useRef<HTMLElement>(null);
	const anchorRef = targetRef ?? localTriggerRef;
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId(undefined, "confirmpopup");
	const msgId = `${panelId}-msg`;

	const stack = useOverlayStack({ active: mounted });
	const floating = useFloating({ open: mounted, triggerRef: anchorRef, panelRef, placement });

	const close = () => ctrl.set(false);
	const toggle = () => ctrl.set(!ctrl.get());
	const accept = () => {
		close();
		onAccept?.();
	};
	const reject = () => {
		close();
		onReject?.();
	};

	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({
		open: mounted,
		onDismiss: () => {
			if (stack.isTop) reject();
		},
		panelRef,
		triggerRef: anchorRef,
	});

	// #region External-anchor wiring
	useEffect(() => {
		const el = targetRef?.current;
		if (!el) return;
		const onClick = () => toggle();
		el.addEventListener("click", onClick);
		el.setAttribute("aria-haspopup", "dialog");
		el.setAttribute("aria-controls", panelId);
		return () => el.removeEventListener("click", onClick);
	}, [targetRef?.current]);

	useEffect(() => {
		targetRef?.current?.setAttribute("aria-expanded", String(isOpen));
	}, [isOpen, targetRef?.current]);
	// #endregion

	const api: ConfirmPopupTriggerApi = { ref: localTriggerRef, toggle, expanded: isOpen, panelId };

	return (
		<>
			{trigger?.(api)}
			{mounted && (
				<Portal zIndex={stack.zIndex}>
					<div
						ref={panelRef}
						id={panelId}
						role="alertdialog"
						aria-describedby={msgId}
						data-state={state}
						class={cx("ui-confirm-popup", className)}
						style={styleVars({
							"--float-top": floating ? `${floating.top}px` : undefined,
							"--float-left": floating ? `${floating.left}px` : undefined,
						})}
						tabIndex={-1}
					>
						<div class="ui-confirm__body">
							{icon && <span class="ui-confirm__icon" aria-hidden="true">{icon}</span>}
							<div id={msgId} class="ui-confirm__message">{message}</div>
						</div>
						<div class="ui-confirm-popup__actions">
							<Button label={rejectLabel} severity="secondary" variant="text" size="sm" onClick={reject} />
							<Button label={acceptLabel} severity={acceptSeverity} size="sm" onClick={accept} />
						</div>
					</div>
				</Portal>
			)}
		</>
	);
}
