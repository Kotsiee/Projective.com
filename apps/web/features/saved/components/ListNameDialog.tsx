import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { SavedCollection } from "@projective/types/org";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { SavedService } from "../core/SavedService.ts";
import { rememberList } from "../core/saved-state.ts";
import { type ListDialog, listDialog } from "../core/saved-filter-state.ts";

/** Props for {@link ListNameDialog}. */
export interface ListNameDialogProps {
	/** Told the list made or renamed, and the sentence to announce. */
	onDone: (list: SavedCollection, created: boolean, message: string) => void;
}

const NAME_MAX = 60;

/** ListNameDialog — name a new list, or rename one. Driven by the shared `listDialog` signal. */
export function ListNameDialog({ onDone }: ListNameDialogProps): JSX.Element {
	const state: ListDialog = listDialog.value;
	const open = useSignal(false);
	const name = useSignal("");
	const error = useSignal("");
	const busy = useSignal(false);

	useEffect(() => {
		open.value = state !== null;
		name.value = state?.mode === "rename" ? state.list.name : "";
		error.value = "";
	}, [state]);

	useEffect(() => {
		if (!open.value && listDialog.peek() !== null) listDialog.value = null;
	}, [open.value]);

	async function submit(): Promise<void> {
		const value = name.value.trim();
		if (!value || !state) return;
		busy.value = true;
		const res = state.mode === "rename"
			? await SavedService.renameCollection(state.list.id, value)
			: await SavedService.createCollection(value);
		busy.value = false;
		if (!res.ok) {
			error.value = res.message;
			return;
		}
		if (state.mode === "new") rememberList(res.data);
		onDone(res.data, state.mode === "new", state.mode === "new" ? `${value} created.` : "List renamed.");
		listDialog.value = null;
	}

	return (
		<Dialog
			visible={open}
			header={state?.mode === "rename" ? "Rename list" : "New list"}
			width="24rem"
			footer={
				<div class="svd-picker__actions">
					<Button variant="text" onClick={() => (listDialog.value = null)}>Cancel</Button>
					<Button
						onClick={() => void submit()}
						disabled={busy.value || !name.value.trim()}
					>
						{state?.mode === "rename" ? "Rename" : "Create"}
					</Button>
				</div>
			}
		>
			{error.value && <InlineNotice text={error.value} align="start" assertive />}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<InputText
					aria-label="List name"
					placeholder="Name your list"
					maxLength={NAME_MAX}
					value={name}
					fluid
				/>
			</form>
		</Dialog>
	);
}
