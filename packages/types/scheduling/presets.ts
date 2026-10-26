import { z } from "zod";
import type { Issue } from "./evaluate.ts";
import {
	type AvailabilityPreset,
	AvailabilityPresetSchema,
	AvailabilityRuleDraftSchema,
} from "./recurrence.ts";
import { AvailabilityKind, ianaTimezone, PresetScope } from "./rows.ts";

/**
 * scheduling.presets — the WRITE payloads around availability presets (plan §5.5–§5.6): saving a
 * preset, binding a listing to one, and the compiled occurrence spans the service hands the
 * service-role door `scheduling.replace_preset_occurrences`.
 *
 * The catalogue's read projection of a binding (`ListingAvailabilityBindingSchema`, with the
 * resolved preset name) lives in `@projective/types/catalogue` and imports
 * {@link AvailabilityBindingMode} from here, so the vocabulary has one definition.
 */

// #region Save
/**
 * `PUT /api/scheduling/presets`. `id` absent creates; present replaces that preset's rules
 * wholesale. Every rule's recurrence is re-checked by {@link AvailabilityRuleDraftSchema}, so a
 * condition RRULE cannot express never reaches the database.
 */
export const SavePresetInputSchema = z.object({
	id: z.string().min(1).max(64).optional(),
	name: z.string().trim().min(1).max(60),
	description: z.string().max(200).default(""),
	timezone: ianaTimezone,
	isDefault: z.boolean().default(false),
	scope: PresetScope.default("library"),
	/** The service a `scope = 'service'` fork belongs to. */
	blueprintId: z.string().max(64).nullable().default(null),
	rules: z.array(AvailabilityRuleDraftSchema).max(64),
}).refine((p) => (p.scope === "service") === (p.blueprintId !== null), {
	message: "A service preset belongs to exactly one service; a library preset to none.",
	path: ["blueprintId"],
}).refine((p) => !(p.scope === "service" && p.isDefault), {
	message: "Only a library preset can be the default.",
	path: ["isDefault"],
}).refine((p) => new Set(p.rules.map((r) => r.id)).size === p.rules.length, {
	message: "Two rules share an id.",
	path: ["rules"],
});
export type SavePresetInput = z.infer<typeof SavePresetInputSchema>;

/** The preset shape a save returns — the stored row, ids resolved. */
export const SavedPresetSchema = AvailabilityPresetSchema;

/**
 * What `PUT /api/scheduling/presets` answers. `issues` are the soft findings the save went ahead
 * with; `compiled` is `null` when the occurrences could not be written (bookings use the weekly hours
 * until the horizon job compiles them); `mirrored` is set only for the default preset, `full: false`
 * meaning the profile's weekly hours carry only the weekly part of it.
 */
export interface SavePresetResult {
	preset: AvailabilityPreset;
	issues: Issue[];
	compiled: { spans: number } | null;
	mirrored: { full: boolean } | null;
}
// #endregion

// #region Usage
/**
 * Who follows a library preset: a Session or Group Session that books against it (by binding, or by
 * falling back to the default), or — for the default — the owner whose weekly hours mirror it.
 * `name` is the service's title; an owner carries none, its `kind` is its name.
 */
export interface PresetUser {
	kind: "service" | "profile" | "team" | "business";
	name: string;
}

/** What `GET /api/scheduling/presets` answers: the live presets, and who follows each library one. */
export interface PresetListResult {
	presets: AvailabilityPreset[];
	/** Keyed by library preset id; a preset nothing follows has an empty list. */
	usage: Record<string, PresetUser[]>;
}
// #endregion

// #region Archive
/** `POST /api/scheduling/presets/archive`. Presets are archived, never deleted. */
export const ArchivePresetInputSchema = z.object({
	id: z.string().min(1).max(64),
});
export type ArchivePresetInput = z.infer<typeof ArchivePresetInputSchema>;

/** What an archive answers: the listing slugs that fell back to the default preset. */
export interface ArchivePresetResult {
	rebound: string[];
}
// #endregion

// #region Bind
/**
 * How a listing takes its availability: the schedule's `default` preset (no binding stored), a
 * library `preset` (linked — edits flow to every bound service) or an `override` (a service-scoped
 * fork).
 */
export const AvailabilityBindingMode = z.enum(["default", "preset", "override"]);
export type AvailabilityBindingMode = z.infer<typeof AvailabilityBindingMode>;

/**
 * Bind a listing's availability. `presetId` is `null` exactly when `mode` is `default`; for
 * `override` it names the preset being forked, and the service returns the fork's id.
 */
export const BindListingAvailabilitySchema = z.object({
	listingId: z.string().min(1).max(64),
	mode: AvailabilityBindingMode,
	presetId: z.string().min(1).max(64).nullable(),
}).refine((b) => (b.mode === "default") === (b.presetId === null), {
	message: "Choose a preset, or use the default.",
	path: ["presetId"],
});
export type BindListingAvailability = z.infer<typeof BindListingAvailabilitySchema>;
// #endregion

// #region Occurrences
/**
 * One compiled span of `scheduling.availability_occurrences`, as the jsonb element the definer
 * door receives: ISO instants, `endsAt` exclusive, and the rules that produced it.
 */
export const OccurrenceSpanSchema = z.object({
	kind: AvailabilityKind,
	startsAt: z.iso.datetime({ offset: true }),
	endsAt: z.iso.datetime({ offset: true }),
	ruleIds: z.array(z.string().min(1).max(64)).max(64),
}).refine((s) => Date.parse(s.endsAt) > Date.parse(s.startsAt), {
	message: "A span must end after it starts.",
	path: ["endsAt"],
});
export type OccurrenceSpan = z.infer<typeof OccurrenceSpanSchema>;

/** An evaluated occurrence in epoch milliseconds, as `evaluate()` yields it. */
export interface OccurrenceInstant {
	kind: AvailabilityKind;
	startsAt: number;
	endsAt: number;
	ruleIds: string[];
}

/** Serialise evaluated occurrences for the occurrence door. */
export function toOccurrenceSpans(occurrences: readonly OccurrenceInstant[]): OccurrenceSpan[] {
	return occurrences.map((o) => ({
		kind: o.kind,
		startsAt: new Date(o.startsAt).toISOString(),
		endsAt: new Date(o.endsAt).toISOString(),
		ruleIds: [...o.ruleIds],
	}));
}
// #endregion
