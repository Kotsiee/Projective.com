import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { SavedCollection, SavedEntityType } from "@projective/types/org";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, InputText, RadioGroup } from "@projective/ui/fields";
import { SavedService } from "../core/SavedService.ts";

/** What the picker files: one saved bookmark (a listing, a person or a channel). */
export interface PickerTarget {
	type: SavedEntityType;
	ref: string;
	title: string;
	/** Its collection now — `null` unfiled, `undefined` not known (nothing is preselected). */
	collectionId?: string | null;
}

/** The radio value for "no collection". */
const UNFILED = "";
/** The radio value while the current collection is not known: matches no option, so none is checked. */
const UNKNOWN = "?";

/**
 * CollectionPicker — file a saved bookmark into one of the caller's named collections, or none
 * (Decision #174). Saving through it saves the thing too, so the listing lane's "Add to collection…"
 * works whether or not it was saved before. A new collection is created in place and selected.
 * Answers the outcome sentence through `onDone` for the opener to announce.
 */
export function CollectionPicker(
	{ open, target, onDone }: {
		open: Signal<boolean>;
		target: PickerTarget | null;
		/** Called after a successful save with the collection it now sits in and the sentence to announce. */
		onDone: (collectionId: string | null, message: string) => void;
	},
): JSX.Element {
	const collections = useSignal<SavedCollection[] | null>(null);
	const choice = useSignal(UNFILED);
	const name = useSignal("");
	const error = useSignal("");
	const busy = useSignal(false);

	useEffect(() => {
		if (!open.value || !target) return;
		choice.value = target.collectionId === undefined ? UNKNOWN : target.collectionId ?? UNFILED;
		error.value = "";
		void SavedService.collections().then((res) => {
			if (res.ok) collections.value = res.data;
			else error.value = res.message;
		});
	}, [open.value, target?.ref]);

	async function create(): Promise<void> {
		const value = name.value.trim();
		if (!value) return;
		busy.value = true;
		const res = await SavedService.createCollection(value);
		busy.value = false;
		if (!res.ok) {
			error.value = res.message;
			return;
		}
		collections.value = [...(collections.value ?? []), res.data];
		choice.value = res.data.id;
		name.value = "";
		error.value = "";
	}

	async function save(): Promise<void> {
		if (!target || choice.value === UNKNOWN) return;
		busy.value = true;
		const collectionId = choice.value === UNFILED ? null : choice.value;
		const res = await SavedService.toggle({ type: target.type, ref: target.ref, saved: true, collectionId });
		busy.value = false;
		if (!res.ok) {
			error.value = res.message;
			return;
		}
		const where = collections.value?.find((c) => c.id === collectionId)?.name;
		open.value = false;
		onDone(collectionId, where ? `Saved to ${where}.` : "Saved, in no collection.");
	}

	const options = [
		{ label: "No collection", value: UNFILED },
		...(collections.value ?? []).map((c) => ({ label: c.name, value: c.id })),
	];

	return (
		<Dialog
			visible={open}
			header="Add to collection"
			width="26rem"
			footer={
				<div class="svd-picker__actions">
					<Button variant="text" onClick={() => (open.value = false)}>Cancel</Button>
					<Button onClick={() => void save()} disabled={busy.value || !target || choice.value === UNKNOWN}>
							Save
						</Button>
				</div>
			}
		>
			{target && <p class="svd-picker__subject">{target.title}</p>}
			{error.value && <InlineNotice text={error.value} align="start" assertive />}
			<RadioGroup
				aria-label="Collection"
				orientation="vertical"
				loading={collections.value === null}
				options={options}
				value={choice.value}
				onValueChange={(v) => (choice.value = v)}
			/>
			<form
				class="svd-picker__new"
				onSubmit={(e) => {
					e.preventDefault();
					void create();
				}}
			>
				<InputText
					aria-label="New collection name"
					placeholder="New collection"
					maxLength={60}
					value={name}
					fluid
				/>
				<Button type="submit" severity="neutral" variant="outlined" disabled={busy.value || !name.value.trim()}>
					Create
				</Button>
			</form>
		</Dialog>
	);
}
