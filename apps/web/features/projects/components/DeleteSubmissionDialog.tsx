import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import { TrashGlyph } from "./submission-glyphs.tsx";

/**
 * DeleteSubmissionDialog — the freelancer's "Delete Submission" confirmation (root task §3.2). A small
 * danger-tinted confirm surface: it names the submission being removed and requires an explicit confirm
 * so an irreversible delete is never a single misclick. STUB — persistence is deferred (the parent runs
 * the optimistic removal). Rendered through {@link BodyPortal} so its `position: fixed` never re-bases
 * onto the transformed/blurred shell chrome (the glass-blur trap); Escape + backdrop click dismiss and
 * focus moves to the cancel control on open.
 */
export interface DeleteSubmissionDialogProps {
	open: boolean;
	/** The submission unit's name, shown in the confirmation copy. */
	name: string;
	onClose: () => void;
	onConfirm: () => void;
}

export function DeleteSubmissionDialog(
	{ open, name, onClose, onConfirm }: DeleteSubmissionDialogProps,
): JSX.Element | null {
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		cancelRef.current?.focus();
		function onKey(e: KeyboardEvent): void {
			if (e.key === "Escape") onClose();
		}
		globalThis.addEventListener?.("keydown", onKey);
		return () => globalThis.removeEventListener?.("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<BodyPortal>
			<div class="subm-confirm" role="presentation" onClick={onClose}>
				<div
					class="subm-confirm__panel"
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="delete-subm-title"
					aria-describedby="delete-subm-body"
					onClick={(e) => e.stopPropagation()}
				>
					<div class="subm-confirm__icon" data-tone="danger" aria-hidden="true">
						<TrashGlyph size={22} />
					</div>
					<h2 id="delete-subm-title" class="subm-confirm__title">Delete submission?</h2>
					<p id="delete-subm-body" class="subm-confirm__body">
						<strong>{name || "This submission"}</strong>{" "}
						and its uploaded files will be removed. This cannot be undone.
					</p>
					<div class="subm-confirm__actions">
						<button
							ref={cancelRef}
							type="button"
							class="subm-actions__btn subm-actions__btn--soft"
							onClick={onClose}
						>
							Cancel
						</button>
						<button
							type="button"
							class="subm-actions__btn subm-actions__btn--danger-solid"
							onClick={onConfirm}
						>
							<span class="subm-actions__icon" aria-hidden="true">
								<TrashGlyph size={16} />
							</span>
							Delete submission
						</button>
					</div>
				</div>
			</div>
		</BodyPortal>
	);
}
