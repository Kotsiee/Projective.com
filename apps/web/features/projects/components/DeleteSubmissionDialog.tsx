import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";
import { TrashGlyph } from "./submission-glyphs.tsx";

/**
 * DeleteSubmissionDialog — the freelancer's "Delete Submission" confirmation (root task §3.2). A thin
 * binding over the shared {@link ConfirmDialog}: it names the submission being removed and requires an
 * explicit confirm so an irreversible delete is never a single misclick. STUB — persistence is deferred
 * (the parent runs the optimistic removal).
 *
 * `ConfirmDialog` supplies the whole overlay contract — the unified `Backdrop`, the modal z-band, the
 * focus trap, Escape, and backdrop dismissal — and raises the role to `alertdialog`. **Dismissal is
 * rejection**: Escape, the backdrop and the × all route to `onClose`, never to `onConfirm`, so there is
 * no path where dismissing this prompt could be mistaken for confirming the delete. Initial focus lands
 * on Cancel, so a stray Enter takes the safe branch.
 *
 * This replaced a hand-rolled surface whose own scrim mixed from `--on-surface` — near-white in dark
 * mode — so it *brightened* the page instead of dimming it, at half the canonical blur.
 */
export interface DeleteSubmissionDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The submission unit's name, shown in the confirmation copy. */
	name: string;
	onClose: () => void;
	onConfirm: () => void;
}

export function DeleteSubmissionDialog(
	{ open, name, onClose, onConfirm }: DeleteSubmissionDialogProps,
): JSX.Element {
	return (
		<ConfirmDialog
			visible={open}
			class="subm-delete"
			header="Delete submission?"
			icon={<TrashGlyph size={22} />}
			message={
				<>
					<strong>{name || "This submission"}</strong>{" "}
					and its uploaded files will be removed. This cannot be undone.
				</>
			}
			rejectLabel="Cancel"
			acceptLabel="Delete submission"
			acceptSeverity="danger"
			onAccept={onConfirm}
			onReject={onClose}
		/>
	);
}
