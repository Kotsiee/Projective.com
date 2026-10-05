import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";

/**
 * ArchiveProjectDialog — the confirmation an owner sees before an engagement is archived from a
 * project kebab menu (the `/projects` feed card, the Project Details sidebar header).
 *
 * The wording is the setup rig's archive prompt verbatim: the two are doors to the same soft archive
 * (`DELETE /api/projects/:slug`, root CLAUDE.md §5 — the row and its history survive), and one action
 * described two ways reads as two actions. The accept button carries `danger` severity because the
 * project leaves circulation for everyone on it.
 */
export interface ArchiveProjectDialogProps {
	visible: Signal<boolean>;
	/** The engagement's title, or `null` while the dialog is closed. */
	title: string | null;
	onAccept: () => void;
}

export function ArchiveProjectDialog(props: ArchiveProjectDialogProps): JSX.Element {
	return (
		<ConfirmDialog
			visible={props.visible}
			header="Archive this project?"
			message={`"${
				props.title || "This project"
			}" leaves circulation and stops accepting applications. Its history, tickets and files are kept.`}
			acceptLabel="Archive project"
			rejectLabel="Keep it"
			acceptSeverity="danger"
			onAccept={props.onAccept}
		/>
	);
}
