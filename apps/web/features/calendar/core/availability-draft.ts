import { effect, signal } from "@preact/signals";
import type { Preset as SchedulerPreset } from "@ui/calendar/islands/availability-scheduler/types.ts";
import {
	LocalKeys,
	readStored,
	removeStored,
	type StorageKey,
	writeStored,
} from "@web/utils/storage-keys.ts";
import { UNSAVED_PRESET_ID } from "@features/catalogue/core/availability-model.ts";
import {
	discardWorking,
	drafts,
	isUnsaved,
	presets,
	saveEditor,
	working,
} from "@features/catalogue/core/availability-store.ts";

/**
 * availability-draft — `/calendar?view=availability`'s local draft (Decision #380). Every template
 * edited and not saved is written to `localStorage` on each edit, one key per acting owner, so a
 * reload, a tab switch or leaving the page loses nothing and nothing asks first. The page restores it
 * on its next visit and says so; a save drops the saved template from it, and the key goes once
 * nothing is pending. Discard changes drops everything back to what the server holds.
 *
 * Time off is not in it: booking and removing days off are written to the server at once, so there is
 * no unsaved state to keep (and a half-typed reason may be private).
 */

// #region Types
/** A draft as stored. */
export interface StoredDraft {
	/** The template that was open, to reopen when the address names none. */
	openId: string | null;
	/** Every template with edits not saved, by id. */
	presets: Record<string, SchedulerPreset>;
}
// #endregion

/** The page opened on a restored draft; the footer says so until it is saved or discarded. */
export const draftRestored = signal(false);

/** The owner's draft key: the registered prefix, then the owner. */
export function draftKeyOf(owner: string): StorageKey {
	return `${LocalKeys.CALENDAR_AVAILABILITY_DRAFT}:${owner}` as StorageKey;
}

// #region Pure
/** The templates pending a save: every stashed one, and the open one while it differs from storage. */
export function pendingOf(
	open: SchedulerPreset | null,
	stashed: Record<string, SchedulerPreset>,
	unsaved: (preset: SchedulerPreset) => boolean,
): Record<string, SchedulerPreset> {
	const pending = { ...stashed };
	if (open && unsaved(open)) pending[open.id] = open;
	return pending;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Shape only: the save door validates the rules themselves, and a rule mid-edit may not pass yet. */
function isPreset(v: unknown): v is SchedulerPreset {
	return isRecord(v) && typeof v.id === "string" && typeof v.name === "string" &&
		typeof v.timezone === "string" && Array.isArray(v.rules) &&
		v.rules.every((r) =>
			isRecord(r) && typeof r.id === "string" && Array.isArray(r.bands) && isRecord(r.pattern)
		);
}

/** A stored draft, or `null` when there is none or it doesn't read as one (it is then ignored). */
export function parseDraft(raw: string | null): StoredDraft | null {
	if (!raw) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(data) || !isRecord(data.presets)) return null;
	const kept = Object.entries(data.presets).filter(([id, p]) => isPreset(p) && p.id === id);
	if (kept.length === 0) return null;
	return {
		openId: typeof data.openId === "string" ? data.openId : null,
		presets: Object.fromEntries(kept) as Record<string, SchedulerPreset>,
	};
}
// #endregion

// #region Store
/**
 * Put the owner's stored draft back as pending edits, keeping only templates that still exist and
 * still differ from what is stored (one saved or archived elsewhere since is no longer a draft).
 * Returns the template to open when the address names none, or `null` when nothing was restored.
 */
export function restoreDraft(owner: string): string | null {
	const stored = parseDraft(readStored("local", draftKeyOf(owner)));
	if (!stored) return null;
	const live = new Set((presets.peek() ?? []).map((p) => p.id));
	const kept = Object.entries(stored.presets).filter(([id, p]) =>
		(id === UNSAVED_PRESET_ID || live.has(id)) && isUnsaved(p)
	);
	if (kept.length === 0) {
		removeStored("local", draftKeyOf(owner));
		return null;
	}
	const restored = Object.fromEntries(kept);
	drafts.value = { ...restored, ...drafts.peek() };
	draftRestored.value = true;
	return stored.openId && restored[stored.openId] ? stored.openId : kept[0][0];
}

/** Write every edit to the owner's draft from now on, and drop the key once nothing is pending. */
export function syncDraft(owner: string): () => void {
	const key = draftKeyOf(owner);
	return effect(() => {
		// `isUnsaved` compares against the stored presets, so a save that re-reads them re-runs this.
		presets.value;
		const open = working.value;
		const pending = pendingOf(open, drafts.value, isUnsaved);
		if (Object.keys(pending).length === 0) {
			removeStored("local", key);
			draftRestored.value = false;
			return;
		}
		writeStored("local", key, JSON.stringify({ openId: open?.id ?? null, presets: pending }));
	});
}

/** Save the open template; a saved draft is no longer "restored". */
export async function saveDraft(): Promise<boolean> {
	const ok = await saveEditor();
	if (ok) draftRestored.value = false;
	return ok;
}

/** Drop every unsaved edit, back to what the server holds; {@link syncDraft} then drops the key. */
export function discardDraft(): void {
	drafts.value = {};
	discardWorking();
	draftRestored.value = false;
}

/** Whether anything at all is waiting for a save. */
export function hasPending(): boolean {
	return Object.keys(pendingOf(working.value, drafts.value, isUnsaved)).length > 0;
}
// #endregion
