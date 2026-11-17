import { type Signal, useSignal } from "@preact/signals";
import type { OwnerSaveResult } from "../core/owner-store.ts";

/** One block editor's save state. */
export interface BlockSave {
	busy: Signal<boolean>;
	/** The refusal or status line the form reads out. */
	message: Signal<string>;
	/** Field-keyed refusals, from the form's own check or the server. */
	errors: Signal<Record<string, string>>;
	/** Run a save once at a time; `onSaved` runs only on success. */
	run: (task: () => Promise<OwnerSaveResult>, onSaved: () => void) => Promise<void>;
}

/** The busy flag, refusal line and field errors every inline editor keeps the same way. */
export function useBlockSave(): BlockSave {
	const busy = useSignal(false);
	const message = useSignal("");
	const errors = useSignal<Record<string, string>>({});

	async function run(task: () => Promise<OwnerSaveResult>, onSaved: () => void): Promise<void> {
		if (busy.peek()) return;
		busy.value = true;
		message.value = "";
		const res = await task();
		busy.value = false;
		if (res.ok) {
			errors.value = {};
			onSaved();
			return;
		}
		errors.value = res.errors;
		message.value = res.message;
	}

	return { busy, message, errors, run };
}
