import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, InputText, Textarea } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import { PlusIcon } from "./glyphs.tsx";

/**
 * CreateStageModal — the client-only "Create New Stage" surface, triggered from the Stages group's
 * inline ＋ (Project Details sidebar), the Kanban board's Add-Column / footer Create Stage, and the
 * Timeline's footer. Title + optional Description, the two fields of `CreateStageInputSchema`; the
 * caller persists them (`BoardService.createStage` → `POST /api/projects/[id]/stages`) and closes the
 * surface only once the server has the stage — a refused create keeps the draft open to correct.
 * While the write is in flight the submit shows its loading state and a second submit is ignored.
 *
 * Built on the shared {@link Dialog}, which supplies the whole overlay contract — the unified
 * `Backdrop`, the modal z-band, the focus trap, Escape, and backdrop dismissal. It replaced a
 * hand-rolled surface whose own scrim mixed from `--on-surface` (near-white in dark mode, so it
 * *brightened* the page instead of dimming it) and whose bespoke buttons declared
 * `:focus-visible { outline: none; box-shadow: none }` — no keyboard focus indicator at all.
 *
 * The footer's submit is wired to the body form by `form={FORM_ID}`, so Enter in either field and a
 * click on Create stage take the one path, rather than the footer duplicating the submit logic.
 */

/** The drafted stage — Title required, Description optional (the purchasing gate lives at the ticket). */
export interface CreateStagePayload {
	name: string;
	description: string;
}

export interface CreateStageModalProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	projectTitle: string;
	onClose: () => void;
	/**
	 * Called with the drafted stage. The parent persists it and closes the modal on success; the
	 * returned promise holds the submit in its loading state until the write settles, and a string it
	 * resolves to is the server's refusal, shown inline while the draft stays open to correct.
	 */
	onCreate: (payload: CreateStagePayload) => Promise<string | null> | void;
}

const FORM_ID = "create-stage-form";
const NAME_ID = "create-stage-name";
const DESC_ID = "create-stage-description";

export function CreateStageModal(
	{ open, projectTitle, onClose, onCreate }: CreateStageModalProps,
): JSX.Element {
	const nameRef = useRef<HTMLDivElement>(null);
	const name = useSignal("");
	const description = useSignal("");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);

	// Reset the draft each time the surface opens. Focus is the Dialog's job (`initialFocusRef`), so
	// this effect no longer moves it, and the Escape listener it used to own is gone with it.
	useEffect(() => {
		if (!open.value) return;
		name.value = "";
		description.value = "";
		error.value = null;
	}, [open.value]);

	async function submit(e: Event): Promise<void> {
		e.preventDefault();
		const n = name.value.trim();
		if (!n || busy.value) return;
		busy.value = true;
		error.value = null;
		try {
			error.value = (await onCreate({ name: n, description: description.value.trim() })) ?? null;
		} finally {
			busy.value = false;
		}
	}

	return (
		<Dialog
			visible={open}
			class="proj-stage-modal"
			header="Create new stage"
			width="min(26rem, 100%)"
			initialFocusRef={nameRef}
			onVisibleChange={(v) => !v && onClose()}
			footer={
				<div class="proj-stage-modal__actions">
					<Button label="Cancel" variant="text" severity="secondary" onClick={onClose} />
					<Button
						type="submit"
						form={FORM_ID}
						label="Create stage"
						icon={PlusIcon}
						loading={busy.value}
					/>
				</div>
			}
		>
			<p class="proj-stage-modal__note">
				Add a stage to{" "}
				<strong>{projectTitle}</strong>. Reordering stages changes the workflow sequence; its escrow
				milestone is negotiated with the freelancer before work begins.
			</p>
			<form id={FORM_ID} class="proj-stage-modal__form" onSubmit={submit}>
				<div ref={nameRef} class="proj-stage-modal__field">
					<label class="proj-stage-modal__label" for={NAME_ID}>Stage name</label>
					<InputText
						id={NAME_ID}
						value={name}
						fluid
						required
						placeholder="e.g. Design Review"
						maxLength={120}
					/>
				</div>
				<div class="proj-stage-modal__field">
					<label class="proj-stage-modal__label" for={DESC_ID}>
						Description <span class="proj-stage-modal__hint">Optional</span>
					</label>
					<Textarea
						id={DESC_ID}
						value={description}
						fluid
						rows={3}
						maxLength={2000}
						placeholder="What this stage delivers, acceptance criteria, notes…"
					/>
				</div>
				{error.value && <p class="proj-stage-modal__error" role="alert">{error.value}</p>}
			</form>
		</Dialog>
	);
}
