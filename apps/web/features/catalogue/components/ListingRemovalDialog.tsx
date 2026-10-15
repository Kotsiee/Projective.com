import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";

/** What a removal does: a reversible archive, or a permanent delete. */
export type RemovalKind = "archive" | "delete";

/** Props for {@link ListingRemovalDialog}. */
export interface ListingRemovalDialogProps {
	visible: Signal<boolean>;
	kind: RemovalKind;
	/** What is being removed: a listing's title in quotes, or "3 listings". */
	subject: string;
	/** Selected listings a delete will skip because buyers have engaged with them. */
	skipped?: number;
	onConfirm: () => void;
	onCancel?: () => void;
}

/**
 * ListingRemovalDialog — the one confirmation for taking listings out of the catalogue, worded for
 * what will actually happen (Decision #221): an archive keeps the listing and its history and can be
 * undone; a delete removes it for good and is offered only for listings no buyer has engaged with.
 */
export function ListingRemovalDialog(props: ListingRemovalDialogProps): JSX.Element {
	const { visible, kind, subject, skipped = 0, onConfirm, onCancel } = props;
	const skippedLine = skipped > 0
		? ` ${skipped} other ${
			skipped === 1 ? "listing has" : "listings have"
		} buyer history and will be skipped. Archive ${skipped === 1 ? "it" : "them"} instead.`
		: "";
	return kind === "delete"
		? (
			<ConfirmDialog
				visible={visible}
				header={`Delete ${subject} permanently?`}
				message={`This removes the listing, its showcase and its settings for good. It can't be undone.${skippedLine}`}
				acceptLabel="Delete permanently"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={onConfirm}
				onReject={onCancel}
			/>
		)
		: (
			<ConfirmDialog
				visible={visible}
				header={`Archive ${subject}?`}
				message="Buyers can no longer find or buy it. Its orders, messages and reviews stay, and you can restore it to drafts at any time."
				acceptLabel="Archive"
				rejectLabel="Keep"
				onAccept={onConfirm}
				onReject={onCancel}
			/>
		);
}
