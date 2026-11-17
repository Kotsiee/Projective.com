import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { ProfileEditModel, ProfileView } from "@projective/types/profile";
import {
	appendIndex,
	type Ledger,
	type LedgerDraft,
	rowErrors,
	saveRowPatch,
} from "../../core/owner-experience.ts";
import { type OwnerSaveResult, saveOwnerPatch } from "../../core/owner-store.ts";
import { useBlockSave } from "../../hooks/useBlockSave.ts";
import { BlockForm } from "./OwnerBlock.tsx";
import { LedgerDraftFields } from "./LedgerForms.tsx";

/**
 * LedgerEditors — the owner's two ways into one Experience-section row (Decision #439): an existing
 * row is edited IN PLACE ({@link LedgerRowEditor}, the row swapped for its fields), and a new one is
 * added through a dialog ({@link LedgerAddDialog}) rather than a form that grows the page. Both save
 * the whole ledger through `org.save_profile` and show a refusal under the field it names.
 */

/** What each ledger's row is called, for labels and the dialog's title. */
export const LEDGER_NOUN: Record<Ledger, { add: string; one: string }> = {
	experience: { add: "Add a role", one: "role" },
	education: { add: "Add education", one: "qualification" },
	certifications: { add: "Add a certification", one: "certification" },
};

interface LedgerSaveProps {
	handle: string;
	profile: ProfileView;
	model: ProfileEditModel;
}

/** Save `draft` over the row `id` (or as a new row), with the refusals re-keyed to the row's fields. */
async function saveDraft(
	{ handle, profile, model }: LedgerSaveProps,
	draft: LedgerDraft,
	id: string | null,
	index: number,
): Promise<OwnerSaveResult> {
	const res = await saveOwnerPatch(handle, saveRowPatch(model, draft, id), profile);
	return res.ok ? res : { ...res, errors: rowErrors(res.errors, draft.ledger, index) };
}

// #region Row editor
export interface LedgerRowEditorProps extends LedgerSaveProps {
	id: string;
	index: number;
	initial: LedgerDraft;
	close: () => void;
}

/** One stored row, edited where it stands. */
export function LedgerRowEditor(props: LedgerRowEditorProps): JSX.Element {
	const draft = useSignal<LedgerDraft>(props.initial);
	const save = useBlockSave();
	const dirty = JSON.stringify(draft.value.row) !== JSON.stringify(props.initial.row);
	const noun = LEDGER_NOUN[props.initial.ledger].one;

	return (
		<BlockForm
			label={`Edit this ${noun}`}
			guardId={`${props.initial.ledger}:${props.id}`}
			dirty={dirty}
			busy={save.busy.value}
			message={save.errors.value.form ?? save.message.value}
			onCancel={props.close}
			onSave={() =>
				void save.run(() => saveDraft(props, draft.peek(), props.id, props.index), props.close)}
		>
			<LedgerDraftFields
				draft={draft.value}
				errors={save.errors.value}
				onChange={(next) => (draft.value = next)}
			/>
		</BlockForm>
	);
}
// #endregion

// #region Add dialog
export interface LedgerAddDialogProps extends LedgerSaveProps {
	open: Signal<boolean>;
	/** The blank row the dialog opened on; its ledger decides the fields. */
	initial: LedgerDraft;
	/** The row was stored — say so where the page announces. */
	onAdded: (noun: string) => void;
}

/** A new row, asked for in a dialog; the section shows it the moment the save answers. */
export function LedgerAddDialog(props: LedgerAddDialogProps): JSX.Element {
	const draft = useSignal<LedgerDraft>(props.initial);
	const save = useBlockSave();
	const scope = useRef<HTMLDivElement>(null);
	const { ledger } = props.initial;
	const noun = LEDGER_NOUN[ledger];
	const dirty = JSON.stringify(draft.value.row) !== JSON.stringify(props.initial.row);
	const close = () => (props.open.value = false);

	function add(): void {
		if (!dirty) return;
		void save.run(
			() => saveDraft(props, draft.peek(), null, appendIndex(props.model, ledger)),
			() => {
				close();
				props.onAdded(noun.one);
			},
		);
	}

	return (
		<Dialog
			visible={props.open}
			header={noun.add}
			width="min(40rem, calc(100vw - var(--space-6)))"
			class="pf-ledger-dialog"
			initialFocusRef={scope}
			footer={
				<div class="pf-modal__actions">
					<p class="pf-inline__status" role="status" aria-live="polite">
						{save.errors.value.form ?? save.message.value}
					</p>
					<Button variant="text" class="pf-edit__ghost" onClick={close}>Cancel</Button>
					<Button
						class="pf-edit__save"
						aria-busy={save.busy.value ? "true" : undefined}
						disabled={!dirty}
						onClick={add}
					>
						{save.busy.value ? "Adding…" : noun.add}
					</Button>
				</div>
			}
		>
			<div
				ref={scope}
				tabIndex={-1}
				class="pf-ledger-dialog__body"
				onKeyDown={(e) => {
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
						e.preventDefault();
						add();
					}
				}}
			>
				<LedgerDraftFields
					draft={draft.value}
					errors={save.errors.value}
					onChange={(next) => (draft.value = next)}
				/>
			</div>
		</Dialog>
	);
}
// #endregion
