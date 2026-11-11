import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";

/**
 * DeleteTicketDialog — the confirmation before a client deletes a ticket from the board's right-click
 * menu. Only a pristine ticket reaches it (never claimed, funded or submitted against — PRODUCT_SPEC
 * §Deletion Protocol), so there is no escrow to release and the sentence says what is lost: the ticket
 * and its brief, for good.
 */
export interface DeleteTicketDialogProps {
	visible: Signal<boolean>;
	/** The ticket's title, or `null` while the dialog is closed. */
	title: string | null;
	onAccept: () => void;
}

export function DeleteTicketDialog(props: DeleteTicketDialogProps): JSX.Element {
	return (
		<ConfirmDialog
			visible={props.visible}
			header="Delete this ticket?"
			message={`"${
				props.title || "This ticket"
			}" and its brief are removed from the board for good. Nobody has claimed or funded it, so no money moves.`}
			acceptLabel="Delete ticket"
			rejectLabel="Keep it"
			acceptSeverity="danger"
			onAccept={props.onAccept}
		/>
	);
}
