import { signal } from "@preact/signals";
import {
	type ProfileEditModel,
	type ProfileSavePatch,
	ProfileSavePatchSchema,
	type ProfileView,
} from "@projective/types/profile";
import { errorsFromIssues } from "./edit-model.ts";
import { ProfileService } from "./ProfileService.ts";

/**
 * owner-store — the state the owner's islands on `/[handle]` share (Decision #439): the edit model as
 * STORED (seeded from the first byte, replaced by every save's answer) and the display projection as
 * last read, so a block saved in the context bar redraws the hero's name and the sticky band too.
 *
 * Module-level signals, so they are shared by every request the SERVER renders: they are written in
 * the browser only (effects and save handlers, never during render — `useOwnerModel`), and on the
 * server they stay `null`, so every render falls back to its own request's props.
 */

/** The stored edit model; `null` until an owner island seeds it. */
export const ownerModel = signal<ProfileEditModel | null>(null);

/** The display projection re-read after a save; `null` while the first byte's is still current. */
export const ownerView = signal<ProfileView | null>(null);

/** Seed the model from the first byte, once per page. */
export function seedOwnerModel(model: ProfileEditModel | null | undefined): void {
	if (model && !ownerModel.peek()) ownerModel.value = model;
}

/** The profile as the owner should see it now: the re-read projection, else the first byte's. */
export function liveProfile(initial: ProfileView): ProfileView {
	return ownerView.value ?? initial;
}

/** A save's outcome, keyed by field for the form that sent it. */
export type OwnerSaveResult =
	| { ok: true }
	| { ok: false; message: string; errors: Record<string, string> };

/** Lay the saved text fields over the projection, so a block redraws before the re-read lands. */
function withSavedText(view: ProfileView, model: ProfileEditModel): ProfileView {
	const individual = model.ownerType === "user";
	const name = individual ? `${model.firstName} ${model.lastName}`.trim() : model.name.trim();
	return {
		...view,
		name: name || view.name,
		headline: model.headline,
		story: model.story,
		location: {
			city: model.city,
			country: model.country,
			timezone: model.timezone || view.location.timezone,
		},
	};
}

/** Re-read the display projection (resolved skills, languages, hours and showcase) after a write. */
export async function refreshOwnerView(handle: string, fallback?: ProfileView): Promise<void> {
	const res = await ProfileService.overview(handle);
	if (res.ok && res.data) ownerView.value = res.data.profile;
	else if (fallback && !ownerView.peek()) ownerView.value = fallback;
}

/**
 * Save one block's patch through `org.save_profile`, checked first against the route's own schema so
 * a refusal is pinned to its field before anything travels. An empty patch is a no-op success.
 */
export async function saveOwnerPatch(
	handle: string,
	patch: ProfileSavePatch,
	current: ProfileView,
): Promise<OwnerSaveResult> {
	if (Object.keys(patch).length === 0) return { ok: true };
	const parsed = ProfileSavePatchSchema.safeParse(patch);
	if (!parsed.success) {
		return {
			ok: false,
			message: "Some details need fixing before they can be saved.",
			errors: errorsFromIssues(parsed.error.issues),
		};
	}
	const res = await ProfileService.save(handle, parsed.data);
	if (!res.ok || !res.data) {
		return {
			ok: false,
			message: res.message ?? "Your changes couldn't be saved.",
			errors: res.errors ?? {},
		};
	}
	ownerModel.value = res.data.model;
	ownerView.value = withSavedText(ownerView.peek() ?? current, res.data.model);
	await refreshOwnerView(handle);
	return { ok: true };
}

// #region Unsaved-edit guard
const dirtyBlocks = new Set<string>();
let guardInstalled = false;

function onBeforeUnload(event: BeforeUnloadEvent): void {
	if (dirtyBlocks.size === 0) return;
	event.preventDefault();
	event.returnValue = "";
}

/** Mark an open editor as holding unsaved edits, so leaving the page asks first. */
export function setBlockDirty(id: string, dirty: boolean): void {
	if (dirty) dirtyBlocks.add(id);
	else dirtyBlocks.delete(id);
	if (!guardInstalled && typeof globalThis.addEventListener === "function") {
		globalThis.addEventListener("beforeunload", onBeforeUnload);
		guardInstalled = true;
	}
}
// #endregion
