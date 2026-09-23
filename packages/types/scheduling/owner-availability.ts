import { z } from "zod";

/**
 * scheduling.owner-availability — the Zod SSOT for the profile OWNER's Availability editor
 * (`/[handle]/edit/availability`): the weekly bands they work, whether that schedule is published,
 * and the discovery-call parameters a visitor books against.
 *
 * It is the editor's shape of three tables — `scheduling.schedules` (timezone + published),
 * `scheduling.availability_rules` (the weekly bands) and `scheduling.call_settings` — written in one
 * transaction by `scheduling.save_owner_availability`. Field limits mirror the column CHECKs, so a
 * value the form accepts is one the database stores.
 */

// #region Bands

/** One weekly band, in minutes from local midnight in the schedule's own timezone. */
export const OwnerBandSchema = z.object({
	/** 0 = Sunday … 6 = Saturday (the JS `Date#getDay` convention). */
	weekday: z.number().int().min(0).max(6),
	startMinute: z.number().int().min(0).max(1439),
	endMinute: z.number().int().min(1).max(1440),
	/** `working_hours` = "at my desk"; `call_window` = the narrower "you may book a call" subset. */
	kind: z.enum(["working_hours", "call_window"]).default("working_hours"),
}).refine((b) => b.endMinute > b.startMinute, {
	message: "The end time must be after the start time.",
	path: ["endMinute"],
});
export type OwnerBand = z.infer<typeof OwnerBandSchema>;

/** Whether two bands of the same kind on the same day overlap. The editor refuses what the DB would. */
export function bandsOverlap(a: OwnerBand, b: OwnerBand): boolean {
	return a.weekday === b.weekday && a.kind === b.kind && a.startMinute < b.endMinute &&
		b.startMinute < a.endMinute;
}

// #endregion

// #region Call settings

export const OwnerCallSettingsSchema = z.object({
	/** Master switch: takes discovery calls at all. */
	acceptsCalls: z.boolean(),
	/** A free, short introductory ("courtesy") call. */
	courtesyEnabled: z.boolean(),
	courtesyDurationMinutes: z.number().int().min(5).max(240),
	/** 0 = no weekly cap. */
	courtesyMaxPerWeek: z.number().int().min(0).max(100),
	/** Days before the same person may book another free call; 0 = none. */
	courtesyCooldownDays: z.number().int().min(0).max(365),
	/** A paid consultation. */
	paidEnabled: z.boolean(),
	paidDurationMinutes: z.number().int().min(5).max(480),
	/** The paid fee in minor units, or `null` while no fee is set. */
	feeAmountMinor: z.number().int().min(0).nullable(),
	feeCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
	/** Minutes kept clear before / after a call. */
	bufferBeforeMinutes: z.number().int().min(0).max(240),
	bufferAfterMinutes: z.number().int().min(0).max(240),
	/** The least notice a booking needs, in minutes. */
	minNoticeMinutes: z.number().int().min(0).max(60 * 24 * 30),
	/** How far ahead a booking may be made, in days. */
	maxAdvanceDays: z.number().int().min(1).max(365),
	/** Confirm requests automatically rather than approving each one. */
	autoConfirm: z.boolean(),
	/** A booker must say what the call is about. */
	agendaRequired: z.boolean(),
}).refine(
	(c) => !c.paidEnabled || (c.feeAmountMinor !== null && c.feeAmountMinor > 0 && c.feeCurrency !== null),
	{ message: "Set a fee to offer paid calls.", path: ["feeAmountMinor"] },
);
export type OwnerCallSettings = z.infer<typeof OwnerCallSettingsSchema>;

/** The call settings a schedule nobody has configured behaves as — the table's column defaults. */
export const DEFAULT_CALL_SETTINGS: OwnerCallSettings = {
	acceptsCalls: false,
	courtesyEnabled: false,
	courtesyDurationMinutes: 15,
	courtesyMaxPerWeek: 0,
	courtesyCooldownDays: 0,
	paidEnabled: false,
	paidDurationMinutes: 30,
	feeAmountMinor: null,
	feeCurrency: null,
	bufferBeforeMinutes: 0,
	bufferAfterMinutes: 10,
	minNoticeMinutes: 720,
	maxAdvanceDays: 60,
	autoConfirm: false,
	agendaRequired: true,
};

// #endregion

// #region The whole editor

export const OwnerAvailabilitySchema = z.object({
	/** IANA timezone the bands are expressed in. */
	timezone: z.string().min(1).max(60),
	/** Published schedules are visible (and bookable) to visitors; an unpublished one is a draft. */
	published: z.boolean(),
	bands: z.array(OwnerBandSchema).max(42),
	/** `null` for an owner who cannot take calls (a buyer entity). */
	call: OwnerCallSettingsSchema.nullable(),
}).refine((v) => {
	for (let i = 0; i < v.bands.length; i++) {
		for (let j = i + 1; j < v.bands.length; j++) if (bandsOverlap(v.bands[i], v.bands[j])) return false;
	}
	return true;
}, { message: "Two hours on the same day overlap.", path: ["bands"] });
export type OwnerAvailability = z.infer<typeof OwnerAvailabilitySchema>;

/** A weekday working window the editor offers as the starting point: Mon–Fri, 09:00–17:00. */
export function defaultBands(): OwnerBand[] {
	return [1, 2, 3, 4, 5].map((weekday) => ({
		weekday,
		startMinute: 9 * 60,
		endMinute: 17 * 60,
		kind: "working_hours" as const,
	}));
}

// #endregion
