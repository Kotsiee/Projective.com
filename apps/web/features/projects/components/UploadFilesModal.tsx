import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import { UploadGlyph } from "./submission-glyphs.tsx";

/**
 * UploadFilesModal — the "Upload Files" surface for an in-progress draft submission (root task §3.2).
 * A STUB / "future modal slot": it presents the drop target the real uploader will fill (drag-and-drop +
 * browse), but persistence + the actual file transfer land with the backend (`files.*` writes). Rendered
 * through {@link BodyPortal} to beat the glass-blur `position: fixed` trap; Escape + backdrop dismiss.
 */
export interface UploadFilesModalProps {
	open: boolean;
	/** The submission the files attach to (shown in the copy). */
	submissionName: string;
	onClose: () => void;
}

export function UploadFilesModal(
	{ open, submissionName, onClose }: UploadFilesModalProps,
): JSX.Element | null {
	const closeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		closeRef.current?.focus();
		function onKey(e: KeyboardEvent): void {
			if (e.key === "Escape") onClose();
		}
		globalThis.addEventListener?.("keydown", onKey);
		return () => globalThis.removeEventListener?.("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<BodyPortal>
			<div class="subm-modal" role="presentation" onClick={onClose}>
				<div
					class="subm-modal__panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby="upload-subm-title"
					onClick={(e) => e.stopPropagation()}
				>
					<h2 id="upload-subm-title" class="subm-modal__title">Upload files</h2>
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

					<div class="subm-modal__actions">
						<button
							ref={closeRef}
							type="button"
							class="subm-actions__btn subm-actions__btn--soft"
							onClick={onClose}
						>
							Done
						</button>
					</div>
				</div>
			</div>
		</BodyPortal>
	);
}
