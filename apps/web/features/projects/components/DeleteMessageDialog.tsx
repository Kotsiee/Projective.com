import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";

/**
 * DeleteMessageDialog — the one confirmation before an author deletes a message for everyone
 * (PROJECTS CH1). The sentence says what the others will see (a "Message deleted" placeholder where
 * it was) and that it cannot be undone. It does not promise the words are gone from the record:
 * they are kept as evidence that only a dispute review and the platform's operators can read.
 */
export interface DeleteMessageDialogProps {
	visible: Signal<boolean>;
	onAccept: () => void;
}

export function DeleteMessageDialog(props: DeleteMessageDialogProps): JSX.Element {
	return (
		<ConfirmDialog
			visible={props.visible}
			header="Delete this message for everyone?"
			message="Everyone in this conversation will see “Message deleted” where it was. This can't be undone. A copy is kept for dispute reviews and is never shown in the chat."
			acceptLabel="Delete for everyone"
			rejectLabel="Keep it"
			acceptSeverity="danger"
			onAccept={props.onAccept}
		/>
	);
}
