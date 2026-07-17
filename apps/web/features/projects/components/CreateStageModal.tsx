import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { PlusIcon } from "./glyphs.tsx";

/**
 * CreateStageModal — the client-only "Create New Stage" surface triggered from the Stages group's
 * inline ＋. STUB: shaping is real (name + optional brief), but persistence is deferred to the live
 * path (the `projects.create_stage` RPC + escrow milestone wiring) — mirroring the Create-Project
 * modal deferral. Accessible: `role="dialog"` + `aria-modal`, Escape to close, focus moves to the
 * name field on open, backdrop click dismisses.
 */

export interface CreateStageModalProps {
	open: boolean;
	projectTitle: string;
	onClose: () => void;
	/** Called with the drafted stage name (stub — the parent decides what to do). */
	onCreate: (name: string) => void;
}

export function CreateStageModal(
	{ open, projectTitle, onClose, onCreate }: CreateStageModalProps,
): JSX.Element | null {
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
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
		const name = nameRef.current?.value.trim();
		if (!name) return;
		onCreate(name);
	}

	return (
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
					<strong>{projectTitle}</strong>. Its escrow milestone is negotiated with the freelancer
					before work begins.
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
						/>
					</label>
					<div class="proj-stage-modal__actions">
						<button
							type="button"
							class="proj-stage-modal__btn"
							onClick={onClose}
						>
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
	);
}
