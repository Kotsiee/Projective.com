import type { JSX, VNode } from "preact";
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
 * matching callback. Inherits the Dialog focus trap, Escape handling, and `role="dialog"` semantics;
 * the accept button takes initial focus intent via DOM order after the (secondary) reject button.
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
			class={className}
			onVisibleChange={(v) => {
				onVisibleChange?.(v);
				if (!v) onReject?.();
			}}
			footer={
				<>
					<Button label={rejectLabel} severity="secondary" variant="text" onClick={reject} />
					<Button label={acceptLabel} severity={acceptSeverity} onClick={accept} />
				</>
			}
		>
			<div class="ui-confirm__body">
				{icon && <span class="ui-confirm__icon" aria-hidden="true">{icon}</span>}
				<div class="ui-confirm__message">{message}</div>
			</div>
		</Dialog>
	);
}
