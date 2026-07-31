import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import "../styles/confirm.css";
import { Dialog } from "./Dialog.tsx";
import { Button } from "../../fields/components/Button.tsx";
import { useControllable } from "../../hooks/useControllable.ts";
import type { Severity } from "../../fields/types/mod.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** Props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
	/** Visibility — raw boolean (uncontrolled) or `Signal<boolean>` (controlled). */
	visible: Bindable<boolean>;
	/** The confirmation prompt. */
	message: string | VNode;
	/** Optional header/title (default `"Confirm"`). */
	header?: string;
	/** Optional leading icon/glyph node shown beside the message. */
	icon?: VNode;
	/** Accept button label (default `"Yes"`). */
	acceptLabel?: string;
	/** Reject button label (default `"No"`). */
	rejectLabel?: string;
	/** Severity of the accept button (default `"primary"`). */
	acceptSeverity?: Severity;
	/** Invoked when the user accepts. */
	onAccept?: () => void;
	/** Invoked when the user rejects or dismisses. */
	onReject?: () => void;
	/** Fired whenever visibility changes. */
	onVisibleChange?: (visible: boolean) => void;
	/** Extra class(es) merged onto the dialog panel. */
	class?: string;
}
// #endregion

/**
 * ConfirmDialog — a modal confirmation built on {@link Dialog}. Renders the message (with an optional
 * icon) and a reject/accept action pair; accepting or rejecting closes the dialog and fires the
 * matching callback. Inherits the Dialog focus trap and Escape handling, and raises the role to
 * `alertdialog` so the prompt is announced with the urgency its consequence warrants.
 *
 * **Dismissal is rejection.** Escape, the backdrop and the × all route through `onVisibleChange` to
 * `onReject`, never `onAccept` — there is no path where dismissing a destructive prompt could be
 * mistaken for confirming it. Initial focus is placed on the action group, whose first control is the
 * REJECT button, so a stray Enter takes the safe branch rather than the header's × or the accept.
 */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
	const {
		visible,
		message,
		header = "Confirm",
		icon,
		acceptLabel = "Yes",
		rejectLabel = "No",
		acceptSeverity = "primary",
		onAccept,
		onReject,
		onVisibleChange,
		class: className,
	} = props;

	const ctrl = useControllable<boolean>(visible, false, onVisibleChange);
	const actionsRef = useRef<HTMLDivElement>(null);

	const accept = () => {
		ctrl.set(false);
		onAccept?.();
	};
	const reject = () => {
		ctrl.set(false);
		onReject?.();
	};

	return (
		<Dialog
			visible={ctrl.signal}
			header={header}
			role="alertdialog"
			class={className}
			initialFocusRef={actionsRef}
			onVisibleChange={(v) => {
				onVisibleChange?.(v);
				if (!v) onReject?.();
			}}
			footer={
				<div ref={actionsRef} class="ui-confirm__actions">
					<Button label={rejectLabel} severity="secondary" variant="text" onClick={reject} />
					<Button label={acceptLabel} severity={acceptSeverity} onClick={accept} />
				</div>
			}
		>
			<div class="ui-confirm__body">
				{icon && <span class="ui-confirm__icon" aria-hidden="true">{icon}</span>}
				<div class="ui-confirm__message">{message}</div>
			</div>
		</Dialog>
	);
}
