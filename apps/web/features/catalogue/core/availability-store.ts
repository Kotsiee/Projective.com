import { computed, signal } from "@preact/signals";
import type {
	Preset as SchedulerPreset,
	SchedulerTemplate,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import type {
	AvailabilityPreset,
	BindListingAvailability,
	PresetUser,
} from "@projective/types/scheduling";
import type { BindListingAvailabilityResult } from "../types/catalogue-types.ts";
import type { CatalogueResult } from "../types/results.ts";
import { WorkspaceService } from "./WorkspaceService.ts";
import { draft, setAvailabilityBinding } from "./workspace-store.ts";
import {
	defaultPreset,
	effectivePreset,
	libraryPresets,
	saveInputOf,
	type SaveInputPatch,
	schedulerPresetOf,
	starterPreset,
} from "./availability-model.ts";

/**
 * availability-store — the availability modal's state and its writes (plan §5.5–§5.6). A preset is
 * saved whole through `PUT /api/scheduling/presets` (which compiles it for the booking gate) and
 * archived through `POST /api/scheduling/presets/archive`. Inside a listing workspace a save also
 * writes the listing's binding through `POST /api/catalogue/availability`; neither is a listing patch
 * field, so neither marks the listing unsaved, and the binding lands on the workspace draft directly.
 * With no listing loaded (`/calendar`, Settings, the profile editor) the modal manages the owner's
 * templates alone and stays open across saves. The rules for what is sent are pure, in
 * `availability-model.ts`.
 */

// #region Signals
/** The seller's live presets; `null` until read. */
export const presets = signal<AvailabilityPreset[] | null>(null);
/** Who follows each library preset, keyed by preset id. */
export const usage = signal<Record<string, PresetUser[]>>({});
/** Unsaved edits to templates other than the open one, keyed by preset id; Cancel drops them. */
export const drafts = signal<Record<string, SchedulerPreset>>({});
/** Bumped by every preset save or archive, so a page holding the mirrored weekly hours re-reads them. */
export const presetsSaved = signal(0);
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
		usage.value = res.data.usage ?? {};
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

/**
 * Open the modal with no listing: the owner's default template, read first if the presets are not
 * in yet. `timezone` seeds a first template when there are none.
 */
export async function openStudio(timezone: string): Promise<void> {
	if (presets.peek() === null) await loadPresets();
	openEditor(presets.peek()?.[0]?.timezone ?? timezone);
}

/** Close the scheduler without saving; unsaved templates are dropped. */
export function closeEditor(): void {
	editorOpen.value = false;
	drafts.value = {};
}

/** The stored preset a scheduler value was opened from, if it has been saved. */
export function storedOf(value: SchedulerPreset | null): AvailabilityPreset | null {
	return value ? presets.peek()?.find((p) => p.id === value.id) ?? null : null;
}

/** Whether `value` differs from what is stored (a template never saved always does). */
export function isUnsaved(value: SchedulerPreset): boolean {
	const stored = storedOf(value);
	return !stored || JSON.stringify(schedulerPresetOf(stored)) !== JSON.stringify(value);
}

function stash(): void {
	const current = working.peek();
	if (current && isUnsaved(current)) drafts.value = { ...drafts.peek(), [current.id]: current };
}

/** Open another template, keeping the open one's unsaved edits to come back to. */
export function selectPreset(id: string): void {
	if (working.peek()?.id === id) return;
	const stored = presets.peek()?.find((p) => p.id === id);
	const next = drafts.peek()[id] ?? (stored ? schedulerPresetOf(stored) : null);
	if (!next) return;
	stash();
	working.value = next;
	intent.value = "linked";
	availabilityNotice.value = null;
}

/** Start a new template from a starting point, in the schedule's zone. */
export function newPreset(template: SchedulerTemplate, timezone: string): void {
	stash();
	const library = libraryPresets(presets.peek() ?? []);
	working.value = {
		...starterPreset(library[0]?.timezone ?? timezone),
		name: template.name,
		description: template.description,
		isDefault: library.length === 0,
		rules: template.rules.map((rule) => ({ ...rule, condition: { ...rule.condition } })),
	};
	intent.value = "linked";
	availabilityNotice.value = null;
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
		if (!problem) {
			await loadPresets();
			presetsSaved.value += 1;
		}
		return problem === null;
	} finally {
		availabilityBusy.value = false;
	}
}

/**
 * Save the open template. With no listing loaded that is all, and the modal stays open on the saved
 * template. In a listing workspace a listing being overridden is forked first (the server copies the
 * preset it followed) and the edits are saved into the fork; otherwise the template is saved and the
 * listing bound to it — its fork, the default, or a library preset — so the binding always matches
 * the preset just saved, and the dialog closes.
 */
export function saveEditor(): Promise<boolean> {
	return run(async () => {
		const value = working.peek();
		const listing = draft.peek();
		const binding = listing?.availabilityBinding ?? null;
		if (!value) return null;

		if (!listing) {
			const saved = await save(value);
			if (typeof saved === "string") return saved;
			working.value = schedulerPresetOf(saved);
			return null;
		}

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
			const mode = saved.scope === "service" ? "override" : saved.isDefault ? "default" : "preset";
			const bound = await bind(mode, mode === "default" ? null : saved.id);
			if (typeof bound === "string") return bound;
		}
		closeEditor();
		return null;
	});
}

/** Archive the open template; services on it fall back to the default, which opens in its place. */
export function archiveWorking(): Promise<boolean> {
	return run(async () => {
		const value = working.peek();
		if (!value || !storedOf(value)) return null;
		const res = await WorkspaceService.archivePreset(value.id);
		if (!res.ok) return failure(res, "This template couldn't be archived.");
		const { [value.id]: _archived, ...rest } = drafts.peek();
		drafts.value = rest;
		const fallback = defaultPreset((presets.peek() ?? []).filter((p) => p.id !== value.id));
		working.value = fallback ? schedulerPresetOf(fallback) : starterPreset(value.timezone);
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
	usage.value = {};
	drafts.value = {};
	presetsError.value = null;
	editorOpen.value = false;
	working.value = null;
	intent.value = "linked";
	availabilityBusy.value = false;
	availabilityNotice.value = null;
	mirrored.value = null;
}
// #endregion
