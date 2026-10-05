import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";
import { AcceptedGlyph } from "./submission-glyphs.tsx";

/**
 * ApproveStageDialog — the reviewer's "Approve Stage" confirmation. A thin binding over the shared
 * {@link ConfirmDialog}: approving a stage releases EVERY held escrow on it to the freelancers who
 * worked it, and that cannot be undone, so it is never a single click.
 *
 * **Dismissal is rejection** (the `ConfirmDialog` contract): Escape, the backdrop and the × route to
 * `onClose`, never to `onConfirm`, and initial focus lands on Cancel so a stray Enter takes the safe
 * branch.
 */
export interface ApproveStageDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The stage being approved, named in the prompt; null falls back to "this stage". */
	stageName: string | null;
	onClose: () => void;
	onConfirm: () => void;
}

export function ApproveStageDialog(
	{ open, stageName, onClose, onConfirm }: ApproveStageDialogProps,
): JSX.Element {
	return (
		<ConfirmDialog
			visible={open}
			class="subm-approve"
			header="Approve stage and release payment?"
			icon={<AcceptedGlyph size={22} />}
			message={
				<>
					Approving <strong>{stageName || "this stage"}</strong>{" "}
					releases its held escrow to the freelancers who worked it. This cannot be undone.
				</>
			}
			rejectLabel="Cancel"
			acceptLabel="Approve and release"
			acceptSeverity="primary"
			onAccept={onConfirm}
			onReject={onClose}
		/>
	);
}
