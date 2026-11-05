import { z } from "zod";
import { slugPattern } from "../slugs/slug.ts";
import { AvailabilityBehavior, RRuleText, timestamp, uuid } from "./rows.ts";

/**
 * routines — a person's named groups of recurring entries (the gym, focused work, language study),
 * so a cadence reads as one thing on their agenda instead of forty disconnected rows (Decision #389).
 *
 * **A routine organises; it does not track.** There is no check-off, no completion and no streak
 * here, and none belongs: `PRODUCT_SPEC.md` §5 keeps attendance streaks out of the product. A routine
 * answers what this time is for and whether a client may book over it.
 *
 * **Its members are ordinary rows of `scheduling.events`**, so nothing downstream learns the word. A
 * member goes out to a provider, or into a file, as the plain event it is, and every busy reader
 * reads the member's own `availabilityBehavior`, never the routine's.
 *
 * Mirrors `supabase/migrations/00000022_tables_scheduling.sql`.
 */

// #region The row
/** The longest a routine's name may be, as `scheduling.routines.name`'s CHECK says. */
export const ROUTINE_NAME_MAX = 60;

const RoutineName = z.string().trim().min(1, "Give the routine a name.").max(ROUTINE_NAME_MAX);

/** A CSS custom-property NAME, as `color_token`'s CHECK says, never a literal colour. */
const ColorToken = z.string().regex(/^--[a-z][a-z0-9-]{0,58}$/, "Expected a design token name.");

/** A row of `scheduling.routines`. Read by the schedule's own side, never by a visitor. */
export const RoutineSchema = z.object({
	id: uuid,
	scheduleId: uuid,
	name: RoutineName,
	/** The opaque, permanent address (`rtn-…`, Decision #88), never derived from the name. */
	slug: z.string().regex(slugPattern("routine")),
	colorToken: ColorToken.nullable(),
	/** `false` is archived: a routine is never deleted, and its entries stay on the calendar. */
	isActive: z.boolean(),
	/** What an entry takes on joining, and follows while it agrees. */
	behavior: AvailabilityBehavior,
	/** The cadence a new entry in this routine repeats on. Nothing is laid down from it alone. */
	recurrenceRule: RRuleText.nullable(),
	metadata: z.record(z.string(), z.unknown()),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type Routine = z.infer<typeof RoutineSchema>;
// #endregion

// #region Write payloads
/** Create a routine on the caller's own schedule, which the server names, never the request. */
export const CreateRoutineInputSchema = z.object({
	name: RoutineName,
	behavior: AvailabilityBehavior.optional(),
	colorToken: ColorToken.optional(),
	recurrenceRule: RRuleText.nullable().optional(),
});
export type CreateRoutineInput = z.infer<typeof CreateRoutineInputSchema>;

/** Change a routine: what is left out stays as it is. `isActive: false` archives it. */
export const UpdateRoutineInputSchema = z.object({
	id: uuid,
	name: RoutineName.optional(),
	behavior: AvailabilityBehavior.optional(),
	colorToken: ColorToken.optional(),
	recurrenceRule: RRuleText.nullable().optional(),
	isActive: z.boolean().optional(),
});
export type UpdateRoutineInput = z.infer<typeof UpdateRoutineInputSchema>;

/**
 * Organise one entry, and with it its whole series: the one write an entry read from a connected
 * calendar takes, because it reaches no provider. `routineId: null` takes it out of its routine, and
 * what is left out stays as it is.
 */
export const OrganiseEntryInputSchema = z.object({
	eventId: z.string().min(1).max(120),
	routineId: uuid.nullable().optional(),
	availabilityBehavior: AvailabilityBehavior.optional(),
});
export type OrganiseEntryInput = z.infer<typeof OrganiseEntryInputSchema>;
// #endregion

// #region Words
/** The word for each behaviour where a line has room for one. */
export const AVAILABILITY_BEHAVIOR_SHORT: Record<AvailabilityBehavior, string> = {
	disruptive: "Disruptive",
	passive: "Passive",
};

/** The word for each behaviour on the control that picks it. */
export const AVAILABILITY_BEHAVIOR_LABEL: Record<AvailabilityBehavior, string> = {
	disruptive: "Disruptive / Busy",
	passive: "Passive / Tentative",
};

/** What each behaviour does, said where the choice is made. */
export const AVAILABILITY_BEHAVIOR_HINT: Record<AvailabilityBehavior, string> = {
	disruptive: "Blocks discovery calls and session bookings.",
	passive: "Stays open, so a client can book over it.",
};
// #endregion
