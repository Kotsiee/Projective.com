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
 *
 * The weekly bands are written by one writer only: the default availability template's mirror
 * (Decision #408). The profile and Settings save {@link SaveOwnerAvailabilitySchema}, which carries
 * no bands, so the stored hours are kept as they are.
 */

// #region Bands

/** One weekly band, in minutes from local midnight in the schedule's own timezone. */
export const OwnerBandSchema = z.object({
	/** 0 = Sunday … 6 = Saturday (the JS `Date#getDay` convention). */
	weekday: z.number().int().min(0).max(6),
	startMinute: z.number().int().min(0).max(1439),
	endMinute: z.number().int().min(1).max(1440),
	/**
	 * Availability is one layer (Decision #408): every band is working hours, and calls are booked
	 * inside them. A stored `call_window` row predates the ruling and is read by nothing.
	 */
	kind: z.literal("working_hours").default("working_hours"),
	/**
	 * A paid call's price for a call starting inside this band, carried from the template rule the
	 * band mirrors; `null` charges the call settings' fee.
	 */
	feeAmountMinor: z.number().int().min(1).nullable().default(null),
	feeCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
}).refine((b) => b.endMinute > b.startMinute, {
	message: "The end time must be after the start time.",
	path: ["endMinute"],
}).refine((b) => (b.feeAmountMinor === null) === (b.feeCurrency === null), {
	message: "A price needs both an amount and a currency.",
	path: ["feeAmountMinor"],
});
export type OwnerBand = z.infer<typeof OwnerBandSchema>;

/** Whether two bands of the same kind on the same day overlap. The editor refuses what the DB would. */
export function bandsOverlap(a: OwnerBand, b: OwnerBand): boolean {
	return a.weekday === b.weekday && a.kind === b.kind && a.startMinute < b.endMinute &&
		b.startMinute < a.endMinute;
}

/** The slice of a weekly band {@link joinTouchingBands} reads. */
export interface WeeklySpan {
	weekday: number;
	startMinute: number;
	endMinute: number;
}

/**
 * Weekly bands for SHOWING hours: each day's bands sorted, and every run of touching or overlapping
 * bands joined into its first. The default template's mirror splits a day where its price changes
 * (Decision #408), and a reader that shows hours shows the day, not its prices.
 */
export function joinTouchingBands<T extends WeeklySpan>(bands: readonly T[]): T[] {
	const sorted = [...bands].sort((a, b) =>
		a.weekday - b.weekday || a.startMinute - b.startMinute || a.endMinute - b.endMinute
	);
	const out: T[] = [];
	for (const band of sorted) {
		const last = out[out.length - 1];
		if (last && last.weekday === band.weekday && band.startMinute <= last.endMinute) {
			out[out.length - 1] = { ...last, endMinute: Math.max(last.endMinute, band.endMinute) };
		} else {
			out.push({ ...band });
		}
	}
	return out;
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

const scheduleFields = {
	/** IANA timezone the bands are expressed in. */
	timezone: z.string().min(1).max(60),
	/** Published schedules are visible (and bookable) to visitors; an unpublished one is a draft. */
	published: z.boolean(),
	/** `null` for an owner who cannot take calls (a buyer entity). */
	call: OwnerCallSettingsSchema.nullable(),
};

/** The owner's schedule as it is read: the settings, and the weekly bands the default template mirrors. */
export const OwnerAvailabilitySchema = z.object({
	...scheduleFields,
	bands: z.array(OwnerBandSchema).max(42),
}).refine((v) => {
	for (let i = 0; i < v.bands.length; i++) {
		for (let j = i + 1; j < v.bands.length; j++) if (bandsOverlap(v.bands[i], v.bands[j])) return false;
	}
	return true;
}, { message: "Two hours on the same day overlap.", path: ["bands"] });
export type OwnerAvailability = z.infer<typeof OwnerAvailabilitySchema>;

/**
 * What `PUT /api/profile/:handle/availability` saves: the time zone, publishing and call settings.
 * No bands, so the stored weekly hours are kept; they are edited on `/calendar?view=availability`.
 */
export const SaveOwnerAvailabilitySchema = z.object(scheduleFields);
export type SaveOwnerAvailability = z.infer<typeof SaveOwnerAvailabilitySchema>;

/** A weekday working window the editor offers as the starting point: Mon–Fri, 09:00–17:00. */
export function defaultBands(): OwnerBand[] {
	return [1, 2, 3, 4, 5].map((weekday) => ({
		weekday,
		startMinute: 9 * 60,
		endMinute: 17 * 60,
		kind: "working_hours" as const,
		feeAmountMinor: null,
		feeCurrency: null,
	}));
}

// #endregion
