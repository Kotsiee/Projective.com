import { z } from "zod";
import { timestamp } from "./common.ts";

// #region Schema
/** One sitting of a block the buyer has already timed: the instant, and the server's label for it. */
export const ScheduledSittingSchema = z.object({
	/** The sitting's start (ISO). */
	at: timestamp,
	/** Pre-formatted in the line's zone ("Tue 12 Aug · 14:00–14:45"), so SSR and the refetch agree. */
	label: z.string().max(80),
});
export type ScheduledSitting = z.infer<typeof ScheduledSittingSchema>;

/**
 * A set-session block line's sittings (Decision #453): how many the block holds, and the ones the
 * buyer timed at booking in the order they are booked — session 1 first (Decision #411). Every sitting
 * past them is booked later, pencilled in weekly and agreed with the provider after payment.
 */
export const SittingScheduleSchema = z.object({
	total: z.number().int().min(2).max(52),
	scheduled: z.array(ScheduledSittingSchema).min(1).max(52),
});
export type SittingSchedule = z.infer<typeof SittingScheduleSchema>;
// #endregion

// #region Derivation
/**
 * The starts a block line has fixed: its first sitting, then each later start the buyer chose
 * (`metadata.laterStarts`), in the order `finance.place_wallet_order` books them. A start that is not
 * an instant, or does not fall after the one before it, ends the run — the payment refuses such a line,
 * so a list past it would promise sittings that will not be booked. Capped at the block's size.
 */
export function scheduledSittingStarts(
	first: string | null,
	laterStarts: unknown,
	total: number,
): string[] {
	if (first === null || Number.isNaN(Date.parse(first))) return [];
	const starts = [new Date(first).toISOString()];
	const later = Array.isArray(laterStarts) ? laterStarts : [];
	for (const raw of later) {
		if (starts.length >= total) break;
		if (typeof raw !== "string") break;
		const at = Date.parse(raw);
		if (Number.isNaN(at) || at <= Date.parse(starts[starts.length - 1])) break;
		starts.push(new Date(at).toISOString());
	}
	return starts;
}

/** "2 of 6 sittings scheduled" — how much of a block the buyer has timed. */
export function sittingsLabel(schedule: SittingSchedule): string {
	const timed = Math.min(schedule.scheduled.length, schedule.total);
	return `${timed} of ${schedule.total} sittings scheduled`;
}

/** "4 booked later" — the sittings of a block left to agree after payment; `null` when none are. */
export function sittingsLaterLabel(schedule: SittingSchedule): string | null {
	const later = schedule.total - Math.min(schedule.scheduled.length, schedule.total);
	return later > 0 ? `${later} booked later` : null;
}
// #endregion
