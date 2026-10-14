import type {
	Preset as SchedulerPreset,
	PresetBinding,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import type { ListingAvailabilityBinding } from "@projective/types/catalogue";
import {
	addDays,
	type AvailabilityPreset,
	type Band,
	evaluate,
	type IsoDate,
	layerBandsFor,
	type PresetLike,
	type SavePresetInput,
	SavePresetInputSchema,
	SCHEDULE_TEMPLATES,
	weekdayOf,
} from "@projective/types/scheduling";

/**
 * availability-model — the pure rules under the Availability section (plan §5.5): which preset a
 * listing books against, the binding line, the scheduler's value and the save payload built from
 * it, the bookable windows ahead (the publish gate's "next 30 days" line) and the read-only
 * fortnight strip. DOM-free and clock-free: "today" is always an argument.
 */

// #region Presets
/** The live library presets, the default first. */
export function libraryPresets(presets: readonly AvailabilityPreset[]): AvailabilityPreset[] {
	return presets.filter((p) => p.scope === "library" && p.archivedAt === null)
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** The schedule's default preset, if it has one. */
export function defaultPreset(
	presets: readonly AvailabilityPreset[],
): AvailabilityPreset | null {
	return presets.find((p) => p.isDefault && p.archivedAt === null) ?? null;
}

/**
 * The preset a listing books against: the one it is bound to, else the schedule's default, else
 * none (the schedule has no presets yet).
 */
export function effectivePreset(
	binding: ListingAvailabilityBinding | null,
	presets: readonly AvailabilityPreset[],
): AvailabilityPreset | null {
	const bound = binding?.presetId ? presets.find((p) => p.id === binding.presetId) : undefined;
	return bound ?? defaultPreset(presets);
}

/** The scheduler's value for a stored preset. */
export function schedulerPresetOf(preset: AvailabilityPreset): SchedulerPreset {
	return {
		id: preset.id,
		name: preset.name,
		description: preset.description,
		timezone: preset.timezone,
		isDefault: preset.isDefault,
		scope: preset.scope,
		blueprintId: preset.blueprintId,
		archivedAt: preset.archivedAt,
		rules: preset.rules.map((rule) => ({ ...rule, condition: { ...rule.condition } })),
	};
}

/** The id a preset not yet saved carries in the editor. */
export const UNSAVED_PRESET_ID = "unsaved";

/**
 * A first preset for a schedule that has none: the "General" template in the seller's zone, as the
 * default, so every listing bound to nothing books against it.
 */
export function starterPreset(timezone: string): SchedulerPreset {
	const general = SCHEDULE_TEMPLATES.find((t) => t.key === "general") ?? SCHEDULE_TEMPLATES[0];
	return {
		id: UNSAVED_PRESET_ID,
		name: "General",
		description: general.description,
		timezone,
		isDefault: true,
		scope: "library",
		blueprintId: null,
		archivedAt: null,
		rules: general.rules.map((rule) => ({ ...rule, condition: { ...rule.condition } })),
	};
}

/** What saving a scheduler value sends, or why it can't be sent. */
export type SaveInputResult =
	| { ok: true; input: SavePresetInput }
	| { ok: false; message: string };

/** How a save re-addresses the scheduler's value. */
export interface SaveInputPatch
	extends Partial<Pick<SavePresetInput, "id" | "name" | "scope" | "blueprintId" | "isDefault">> {
	/** Save as a NEW preset, whatever the value's own id. */
	create?: boolean;
}

/**
 * The `PUT /api/scheduling/presets` payload for a scheduler value. An unsaved preset, or `create`,
 * sends no id (a create); `patch` re-addresses it (into a fork, or a fork saved as a library
 * preset). The schema re-checks every rule, so a recurrence the evaluator would refuse never leaves
 * the page.
 */
export function saveInputOf(preset: SchedulerPreset, patch: SaveInputPatch = {}): SaveInputResult {
	const id = patch.create
		? undefined
		: patch.id ?? (preset.id === UNSAVED_PRESET_ID ? undefined : preset.id);
	const parsed = SavePresetInputSchema.safeParse({
		...(id ? { id } : {}),
		name: patch.name ?? preset.name,
		description: preset.description,
		timezone: preset.timezone,
		isDefault: patch.isDefault ?? preset.isDefault,
		scope: patch.scope ?? preset.scope,
		blueprintId: patch.blueprintId !== undefined ? patch.blueprintId : preset.blueprintId,
		rules: preset.rules,
	});
	if (parsed.success) return { ok: true, input: parsed.data };
	return { ok: false, message: parsed.error.issues[0]?.message ?? "This schedule can't be saved." };
}
// #endregion

// #region Binding line
/** How the section names the availability a listing uses. */
export interface BindingView {
	/** `linked` follows a library preset; `forked` is this listing's own copy. */
	mode: PresetBinding["mode"];
	/** The preset's name ("General"). */
	presetName: string;
	/** The sentence the section prints. */
	sentence: string;
}

/** The binding line for a listing (plan §5.5), or `null` when it has no availability yet. */
export function bindingView(
	binding: ListingAvailabilityBinding | null,
	preset: AvailabilityPreset | null,
): BindingView | null {
	if (!binding && !preset) return null;
	const presetName = binding?.presetName || preset?.name || "your default";
	if (binding?.mode === "override") {
		return { mode: "forked", presetName, sentence: "Custom hours for this service." };
	}
	const sentence = binding?.mode === "preset"
		? `Uses ${presetName}.`
		: `Uses ${presetName}, your default hours.`;
	return { mode: "linked", presetName, sentence };
}

/**
 * What the profile mirror means for the seller, as meta text: the default preset's weekly hours are
 * copied to the weekly bands discovery calls and the profile read, and only the weekly part fits.
 */
export function mirroredNote(mirrored: { full: boolean } | null): string | null {
	if (!mirrored || mirrored.full) return null;
	return "Your profile's call booking uses only the weekly part of these hours.";
}
// #endregion

// #region Windows
/** The days the publish gate looks ahead for a bookable window. */
export const READINESS_DAYS = 30;

/**
 * Bookable session windows (working hours; sessions are booked into those) in the `days` from
 * `today`. Blackouts are not known on the page, so this is the preset's own promise.
 */
export function upcomingWindowCount(
	preset: PresetLike,
	today: IsoDate,
	days: number = READINESS_DAYS,
): number {
	return evaluate(preset, { from: today, to: addDays(today, days - 1) })
		.filter((o) => o.kind === "working_hours").length;
}

/** One day of the read-only strip. */
export interface StripDay {
	date: IsoDate;
	/** "Mon". */
	weekday: string;
	/** "14". */
	day: string;
	/** Working hours that day, in the preset's own zone. */
	bands: Band[];
	/** "09:00–17:30" or "Off". */
	hours: string;
}

function clock(minute: number): string {
	const h = Math.floor(minute / 60) % 24;
	const m = minute % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Bands as a reader says them: "09:00–12:00, 14:00–17:30", or "Off". */
export function bandsLabel(bands: readonly Band[]): string {
	if (bands.length === 0) return "Off";
	return bands.map((b) => `${clock(b.start)}–${b.end === 1440 ? "24:00" : clock(b.end)}`).join(
		", ",
	);
}

/** The `days` from `today` as the strip shows them, in the preset's own zone. */
export function stripDays(
	preset: PresetLike,
	today: IsoDate,
	days = 14,
	locale = "en-GB",
): StripDay[] {
	const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
	const sunday = Date.UTC(2023, 0, 1);
	return Array.from({ length: days }, (_, i) => {
		const date = addDays(today, i);
		const bands = layerBandsFor(preset, date, "working_hours");
		return {
			date,
			weekday: weekday.format(new Date(sunday + weekdayOf(date) * 86_400_000)),
			day: String(Number(date.slice(8, 10))),
			bands,
			hours: bandsLabel(bands),
		};
	});
}
// #endregion
