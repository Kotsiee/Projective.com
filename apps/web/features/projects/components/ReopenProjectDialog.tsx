import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";
import type { EngagementKind } from "../types/projects-types.ts";
import { projectCompleteCopy } from "../core/project-complete-model.ts";

/**
 * ReopenProjectDialog — the client's confirmation before a completed engagement goes back to active
 * so it can be extended (EX1, Decision #546; PRODUCT_SPEC §Extension Logic). A completed engagement
 * takes no new escrow; reopening it is how new tickets or stages are added and funded. Its reviews,
 * history and the lifted protected phase stay as they are.
 */
export interface ReopenProjectDialogProps {
	visible: Signal<boolean>;
	title: string;
	kind: EngagementKind;
	onAccept: () => void;
}

export function ReopenProjectDialog(props: ReopenProjectDialogProps): JSX.Element {
	const copy = projectCompleteCopy(props.kind);
	return (
		<ConfirmDialog
			visible={props.visible}
			header={copy.reopenHeader}
			message={`"${
				props.title || `This ${copy.noun}`
			}" goes back to active, so new work can be added and funded on it. Its history and reviews are kept.`}
			acceptLabel={copy.reopen}
			rejectLabel="Keep it completed"
			onAccept={props.onAccept}
		/>
	);
}
