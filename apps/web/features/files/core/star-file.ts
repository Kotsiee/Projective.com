import type { Signal } from "@preact/signals";
import { toggleSaved, type ToggleOutcome } from "@features/saved/core/saved-state.ts";

/** The fields a file row needs to be starred. */
interface Starrable {
	id: string;
	/** The `files.items` id when the row's own `id` is something else (a channel or message row). */
	assetId?: string | null;
	starred: boolean;
}

/**
 * Star or unstar the file `id` in a list signal through the saved system (Decision #174): the row
 * flips at once, `/api/saved` persists the owner's mark (`files.items.starred`), and a refusal flips it
 * back. `onApplied` hears every visible change, rollback included. Answers the sentence to announce.
 */
export function starFile<T extends Starrable>(
	items: Signal<T[]>,
	id: string,
	onApplied?: (starred: boolean) => void,
): Promise<ToggleOutcome> {
	const file = items.value.find((f) => f.id === id);
	if (!file) return Promise.resolve({ ok: false, message: "" });
	return toggleSaved("file", file.assetId ?? file.id, !file.starred, (starred) => {
		items.value = items.value.map((f) => (f.id === id ? { ...f, starred } : f));
		onApplied?.(starred);
	});
}
