import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import { PlusIcon } from "./glyphs.tsx";

/**
 * CreateStageModal — the client-only "Create New Stage" surface, triggered from the Stages group's
 * inline ＋ (Project Details sidebar) AND from the Kanban board's Add-Column / footer Create Stage. STUB:
 * shaping is real (Title + optional rich-text Description, aligned to `CreateProjectStageSchema`), but
 * persistence is deferred to the live path (`projects.create_stage` RPC + escrow milestone wiring).
 * Accessible: `role="dialog"` + `aria-modal`, Escape to close, focus moves to the name field on open,
 * backdrop click dismisses. Rendered through {@link BodyPortal} so its `position: fixed` never re-bases
 * onto the transformed/blurred shell chrome (the glass-blur trap) when opened from the board body.
 */

/** The drafted stage — Title required, Description optional (the purchasing gate lives at the ticket). */
export interface CreateStagePayload {
	name: string;
	description: string;
}

export interface CreateStageModalProps {
	open: boolean;
	projectTitle: string;
	onClose: () => void;
	/** Called with the drafted stage (stub — the parent decides what to do). */
	onCreate: (payload: CreateStagePayload) => void;
}

export function CreateStageModal(
	{ open, projectTitle, onClose, onCreate }: CreateStageModalProps,
): JSX.Element | null {
	const nameRef = useRef<HTMLInputElement>(null);
	const name = useSignal("");
	const description = useSignal("");

	useEffect(() => {
		if (!open) return;
		name.value = "";
		description.value = "";
		nameRef.current?.focus();
		function onKey(e: KeyboardEvent): void {
			if (e.key === "Escape") onClose();
		}
		globalThis.addEventListener?.("keydown", onKey);
		return () => globalThis.removeEventListener?.("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	function submit(e: Event): void {
		e.preventDefault();
		const n = name.value.trim();
		if (!n) return;
		onCreate({ name: n, description: description.value.trim() });
	}

	return (
		<BodyPortal>
			<div class="proj-stage-modal" role="presentation" onClick={onClose}>
				<div
					class="proj-stage-modal__panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby="create-stage-title"
					onClick={(e) => e.stopPropagation()}
				>
					<h2 id="create-stage-title" class="proj-stage-modal__title">Create new stage</h2>
					<p class="proj-stage-modal__note">
						Add a stage to{" "}
						<strong>{projectTitle}</strong>. Reordering stages changes the workflow sequence; its
						escrow milestone is negotiated with the freelancer before work begins.
					</p>
					<form class="proj-stage-modal__form" onSubmit={submit}>
						<label class="proj-stage-modal__field">
							<span class="proj-stage-modal__label">Stage name</span>
							<input
								ref={nameRef}
								type="text"
								class="proj-stage-modal__input"
								placeholder="e.g. Design Review"
								maxLength={120}
								value={name.value}
								onInput={(e) => (name.value = (e.target as HTMLInputElement).value)}
							/>
						</label>
						<label class="proj-stage-modal__field">
							<span class="proj-stage-modal__label">
								Description <span class="proj-stage-modal__hint">Optional</span>
							</span>
							<textarea
								class="proj-stage-modal__input proj-stage-modal__textarea"
								rows={3}
								maxLength={2000}
								placeholder="What this stage delivers, acceptance criteria, notes…"
								value={description.value}
								onInput={(e) => (description.value = (e.target as HTMLTextAreaElement).value)}
							/>
						</label>
						<div class="proj-stage-modal__actions">
							<button type="button" class="proj-stage-modal__btn" onClick={onClose}>
								Cancel
							</button>
							<button type="submit" class="proj-stage-modal__btn proj-stage-modal__btn--primary">
								<span class="proj-stage-modal__btn-icon" aria-hidden="true">{PlusIcon}</span>
								Create stage
							</button>
						</div>
					</form>
				</div>
			</div>
		</BodyPortal>
	);
}
