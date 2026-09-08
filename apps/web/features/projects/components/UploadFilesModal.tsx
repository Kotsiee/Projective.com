import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import { UploadGlyph } from "./submission-glyphs.tsx";

/**
 * UploadFilesModal — the "Upload Files" surface for an in-progress draft submission (root task §3.2).
 * A STUB / "future modal slot": it presents the drop target the real uploader will fill (drag-and-drop +
 * browse), but persistence + the actual file transfer land with the backend (`files.*` writes).
 *
 * Built on the shared {@link Dialog}, which supplies the whole overlay contract — the unified
 * `Backdrop`, the modal z-band, the focus trap, Escape, and backdrop dismissal — replacing a
 * hand-rolled surface that had no focus trap at all, so Tab walked straight out of the modal and into
 * the page behind it.
 */
export interface UploadFilesModalProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The submission the files attach to (shown in the copy). */
	submissionName: string;
	onClose: () => void;
}

export function UploadFilesModal(
	{ open, submissionName, onClose }: UploadFilesModalProps,
): JSX.Element {
	return (
		<Dialog
			visible={open}
			class="subm-modal"
			header="Upload files"
			width="min(28rem, 100%)"
			onVisibleChange={(v) => !v && onClose()}
			footer={
				<div class="subm-modal__actions">
					<Button label="Done" variant="text" severity="secondary" onClick={onClose} />
				</div>
			}
		>
			<p class="subm-modal__note">
				Add deliverable files to <strong>{submissionName || "this submission"}</strong>.
			</p>

			<div
				class="subm-upload__drop"
				role="button"
				tabIndex={0}
				aria-label="Choose files to upload"
			>
				<span class="subm-upload__icon" aria-hidden="true">
					<UploadGlyph size={28} />
				</span>
				<span class="subm-upload__primary">Drag &amp; drop files here</span>
				<span class="subm-upload__secondary">
					or click to browse — uploads land with the backend
				</span>
			</div>
		</Dialog>
	);
}
