import { computed, signal } from "@preact/signals";
import type { Preset as SchedulerPreset } from "@ui/calendar/islands/availability-scheduler/types.ts";
import type { AvailabilityPreset, BindListingAvailability } from "@projective/types/scheduling";
import type { BindListingAvailabilityResult } from "../types/catalogue-types.ts";
import type { CatalogueResult } from "../types/results.ts";
import { WorkspaceService } from "./WorkspaceService.ts";
import { draft, setAvailabilityBinding } from "./workspace-store.ts";
import {
	effectivePreset,
	saveInputOf,
	type SaveInputPatch,
	schedulerPresetOf,
	starterPreset,
} from "./availability-model.ts";

/**
 * availability-store — the Availability section's state and its two writes (plan §5.5–§5.6). A
 * preset is saved whole through `PUT /api/scheduling/presets` (which compiles it for the booking
 * gate), and the listing's binding through `POST /api/catalogue/availability`. Neither is a listing
 * patch field, so neither marks the listing unsaved; the binding lands on the workspace draft
 * directly. The rules for what is sent are pure, in `availability-model.ts`.
 */

// #region Signals
/** The seller's live presets; `null` until read. */
export const presets = signal<AvailabilityPreset[] | null>(null);
/** Why the presets could not be read, if they could not. */
export const presetsError = signal<string | null>(null);
/** Whether the scheduler dialog is open. */
export const editorOpen = signal(false);
/** The scheduler's value while the dialog is open. */
export const working = signal<SchedulerPreset | null>(null);
/**
 * What saving the dialog does to a linked listing: edit the library preset it follows (`linked`,
 * which every listing bound to it then follows) or make these hours this listing's own (`override`).
 */
export const intent = signal<"linked" | "override">("linked");
/** A write in flight. */
export const availabilityBusy = signal(false);
/** The last write's outcome, worth saying aloud. */
export const availabilityNotice = signal<string | null>(null);
/** The profile-mirror outcome of the last default-preset save. */
export const mirrored = signal<{ full: boolean } | null>(null);
/** The preset the listing books against, as far as the page knows. */
export const boundPreset = computed(() =>
	effectivePreset(draft.value?.availabilityBinding ?? null, presets.value ?? [])
);
// #endregion

// #region Reads
/** Read the seller's presets. */
export async function loadPresets(): Promise<void> {
	const res = await WorkspaceService.presets();
	if (res.ok && res.data) {
		presets.value = res.data.presets;
		presetsError.value = null;
		return;
	}
	presetsError.value = res.message ?? "Your availability couldn't be loaded.";
}
// #endregion

// #region Editor
/** Open the scheduler on the hours the listing books against, or a first preset in `timezone`. */
export function openEditor(timezone: string): void {
	const bound = boundPreset.peek();
	working.value = bound ? schedulerPresetOf(bound) : starterPreset(timezone);
	intent.value = "linked";
	availabilityNotice.value = null;
	editorOpen.value = true;
}

/** Close the scheduler without saving. */
export function closeEditor(): void {
	editorOpen.value = false;
}

function failure<T>(res: CatalogueResult<T>, fallback: string): string {
	const field = res.errors ? Object.values(res.errors)[0] : undefined;
	return res.message ?? field ?? fallback;
}

async function bind(
	mode: BindListingAvailability["mode"],
	presetId: string | null,
): Promise<BindListingAvailabilityResult | string> {
	const listingId = draft.peek()?.id;
	if (!listingId) return "This listing isn't loaded.";
	const res = await WorkspaceService.bindAvailability({ listingId, mode, presetId });
	if (!res.ok || !res.data) return failure(res, "The availability couldn't be applied.");
	setAvailabilityBinding(res.data.binding);
	return res.data;
}

async function save(
	value: SchedulerPreset,
	patch: SaveInputPatch = {},
): Promise<AvailabilityPreset | string> {
	const input = saveInputOf(value, patch);
	if (!input.ok) return input.message;
	const res = await WorkspaceService.savePreset(input.input);
	if (!res.ok || !res.data) return failure(res, "These hours couldn't be saved.");
	mirrored.value = res.data.mirrored;
	return res.data.preset;
}

async function run(task: () => Promise<string | null>): Promise<boolean> {
	if (availabilityBusy.peek()) return false;
	availabilityBusy.value = true;
	availabilityNotice.value = null;
	try {
		const problem = await task();
		availabilityNotice.value = problem;
		if (!problem) await loadPresets();
		return problem === null;
	} finally {
		availabilityBusy.value = false;
	}
}

/**
 * Save the dialog. A linked listing saves the preset it follows and keeps following it; a listing
 * being overridden is forked first (the server copies the preset it followed) and the edits are
 * saved into the fork; a forked listing saves its fork. Each save ends with the binding written, so
 * the listing's binding always matches the preset just saved.
 */
export function saveEditor(): Promise<boolean> {
	return run(async () => {
		const value = working.peek();
		const binding = draft.peek()?.availabilityBinding ?? null;
		if (!value) return null;

		if (intent.peek() === "override" && binding?.mode !== "override") {
			const source = boundPreset.peek();
			if (!source) return "Save these hours once before making them this service's own.";
			const forked = await bind("override", source.id);
			if (typeof forked === "string") return forked;
			if (!forked.preset) return "The copy for this service couldn't be made.";
			const saved = await save(value, {
				id: forked.preset.id,
				name: forked.preset.name,
				scope: "service",
				blueprintId: forked.preset.blueprintId,
				isDefault: false,
			});
			if (typeof saved === "string") return saved;
		} else {
			const saved = await save(value);
			if (typeof saved === "string") return saved;
			const mode = binding?.mode ?? "default";
			const bound = await bind(mode, mode === "default" ? null : saved.id);
			if (typeof bound === "string") return bound;
		}
		editorOpen.value = false;
		return null;
	});
}

/** Point a forked listing back at the schedule's default hours. */
export function revertToDefault(): Promise<boolean> {
	return run(async () => {
		const bound = await bind("default", null);
		if (typeof bound === "string") return bound;
		if (editorOpen.peek() && bound.preset) working.value = schedulerPresetOf(bound.preset);
		intent.value = "linked";
		return null;
	});
}

/** Save the dialog's hours as a new library preset named `name`, and bind the listing to it. */
export function saveAsPreset(name: string): Promise<boolean> {
	return run(async () => {
		const value = working.peek();
		if (!value) return null;
		const saved = await save(value, {
			create: true,
			name,
			scope: "library",
			blueprintId: null,
			isDefault: false,
		});
		if (typeof saved === "string") return saved;
		const bound = await bind("preset", saved.id);
		if (typeof bound === "string") return bound;
		working.value = schedulerPresetOf(saved);
		intent.value = "linked";
		return null;
	});
}

/** Bind the listing to a library preset, or to the default with `null`. */
export function chooseLibraryPreset(presetId: string | null): Promise<boolean> {
	return run(async () => {
		const bound = await bind(presetId ? "preset" : "default", presetId);
		return typeof bound === "string" ? bound : null;
	});
}

/** Forget everything (tests, or leaving the workspace). */
export function resetAvailability(): void {
	presets.value = null;
	presetsError.value = null;
	editorOpen.value = false;
	working.value = null;
	intent.value = "linked";
	availabilityBusy.value = false;
	availabilityNotice.value = null;
	mirrored.value = null;
}
// #endregion
