import { z } from "zod";

/**
 * reminders — the two things a person sees on their calendar, and the alerts they get before them
 * (Decision #388). Zod and pure functions only, importing nothing but `zod`, so `org/preferences.ts`
 * can read it without a cycle and the service, the islands and the contract test share one answer.
 *
 * **Event and Reminder are derived, never stored.** `scheduling.event_kind` stays nine values, because
 * the engine's maps and the database enum are keyed on them. A reader thinks in two: something with a
 * length, and a moment. The SHAPE of the row answers which, so a `general` row with a span is an Event
 * and the same kind with `ends_at = starts_at` is a Reminder, and no write can leave them disagreeing.
 *
 * **An alert belongs to a person, not to an entry.** Two people on one meeting want different leads, a
 * project's events take no client write at all, and an attendee cannot write the event row, so an
 * override lives in `scheduling.event_reminders`, one row per person. The tiers: that row, else the
 * person's own default (`org.user_preferences.ui_settings.calendar_reminders`), else
 * {@link DEFAULT_ENTRY_REMINDERS}. `scheduling.fn_event_alerts` resolves them the same way.
 */

// #region Event vs Reminder
/** The two entries a person reads a calendar in. Derived by {@link entryClassOf}, never stored. */
export const EntryClass = z.enum(["event", "reminder"]);
export type EntryClass = z.infer<typeof EntryClass>;

/** The word for one of each, in a sentence or on a switch. */
export const ENTRY_CLASS_LABEL: Record<EntryClass, string> = {
	event: "Event",
	reminder: "Reminder",
};

/** The word for a group of them, on a filter. */
export const ENTRY_CLASS_PLURAL: Record<EntryClass, string> = {
	event: "Events",
	reminder: "Reminders",
};

/**
 * Which of the two an entry is: a moment (`end <= start`) is a Reminder and anything with a length is
 * an Event. A deadline is always a Reminder, even one a seed or an import gave a span to.
 */
export function entryClassOf(entry: { kind: string; start: number; end: number }): EntryClass {
	return entry.kind === "deadline" || entry.end <= entry.start ? "reminder" : "event";
}
// #endregion

// #region Alerts
/** How an alert reaches its person. Each maps to its own catalog type, so preferences still narrow it. */
export const ReminderChannel = z.enum(["in_app", "email"]);
export type ReminderChannel = z.infer<typeof ReminderChannel>;

/** How far ahead an alert may be set, in minutes: one week. `fn_reminder_rows` holds the same cap. */
export const REMINDER_LEAD_MAX_MINUTES = 10_080;

/** How many alerts one entry carries. `fn_reminder_rows` holds the same cap. */
export const REMINDERS_MAX = 5;

/** One alert: how long before the entry, and how it arrives. `minutes: 0` is at the time. */
export const EntryReminderSchema = z.object({
	minutes: z.number().int().min(0).max(REMINDER_LEAD_MAX_MINUTES),
	channel: ReminderChannel,
});
export type EntryReminder = z.infer<typeof EntryReminderSchema>;

/** A person's alerts for one entry, or their default. `[]` is a real answer: none. */
export const EntryRemindersSchema = z.array(EntryReminderSchema).max(REMINDERS_MAX);

/**
 * What a person who has set nothing gets: ten minutes before, in the app, and never an email they did
 * not ask for. `scheduling.fn_event_alerts` carries the same list, held equal by the contract test.
 */
export const DEFAULT_ENTRY_REMINDERS: readonly EntryReminder[] = [
	{ minutes: 10, channel: "in_app" },
];

/** The leads a person picks from, nearest first. */
export const REMINDER_LEADS: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10_080];

/** The word for each channel. */
export const REMINDER_CHANNEL_LABEL: Record<ReminderChannel, string> = {
	in_app: "In-app",
	email: "Email",
};

/** "At the time", "10 minutes before", "1 hour before", "2 days before", "1 week before". */
export function reminderLeadLabel(minutes: number): string {
	if (minutes <= 0) return "At the time";
	const [amount, unit] = minutes % 10_080 === 0
		? [minutes / 10_080, "week"]
		: minutes % 1440 === 0
		? [minutes / 1440, "day"]
		: minutes % 60 === 0
		? [minutes / 60, "hour"]
		: [minutes, "minute"];
	return `${amount} ${unit}${amount === 1 ? "" : "s"} before`;
}

/** One alert in words: "10 minutes before · In-app". */
export function reminderLabel(reminder: EntryReminder): string {
	return `${reminderLeadLabel(reminder.minutes)} · ${REMINDER_CHANNEL_LABEL[reminder.channel]}`;
}

/** Nearest first, no two alike, capped: what a surface shows and what is stored. */
export function normalizeReminders(list: readonly EntryReminder[]): EntryReminder[] {
	const seen = new Set<string>();
	return [...list]
		.sort((a, b) => a.minutes - b.minutes || a.channel.localeCompare(b.channel))
		.filter((r) => {
			const key = `${r.minutes}:${r.channel}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, REMINDERS_MAX);
}

/** The alert a new row starts as: the nearest in-app lead not yet in use, or `null` when all are. */
export function nextReminder(list: readonly EntryReminder[]): EntryReminder | null {
	const used = new Set(list.filter((r) => r.channel === "in_app").map((r) => r.minutes));
	const minutes = REMINDER_LEADS.find((m) => m > 0 && !used.has(m));
	return minutes === undefined ? null : { minutes, channel: "in_app" };
}

/** What one row needs for {@link takesReminders}, spelled as the column is. */
export interface ReminderEligibilityRow {
	kind: string;
	status: string | null;
	source_connection_id: string | null;
	source_session_event_id: string | null;
	archived_at?: string | null;
}

/**
 * Whether an entry takes these alerts at all — `scheduling.fn_event_takes_reminders` in TypeScript.
 *
 * A row from a connected calendar already alerts through its provider, a sitting has its own T-60,
 * T-15 and T-5 (`session.reminder_*`), and an open slot, a busy block or leave has nobody to remind.
 */
export function takesReminders(row: ReminderEligibilityRow): boolean {
	return !row.source_connection_id && !row.source_session_event_id && !row.archived_at &&
		row.status !== "cancelled" && !["availability", "busy", "holiday"].includes(row.kind);
}
// #endregion

// #region A person's calendar preferences
/**
 * How a picked entry opens (`ui_settings.calendar_inspect_mode`): the rich right inspector, or a
 * compact popover over the grid with a way up to the other two surfaces.
 */
export const CalendarInspectMode = z.enum(["panel", "popover"]);
export type CalendarInspectMode = z.infer<typeof CalendarInspectMode>;

/** The two calendar keys of `ui_settings`, resolved. Carried on the personal page so the first byte has them. */
export const CalendarPrefsSchema = z.object({
	inspectMode: CalendarInspectMode,
	reminders: EntryRemindersSchema,
});
export type CalendarPrefs = z.infer<typeof CalendarPrefsSchema>;

/** What a person who has set nothing behaves as. */
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
	inspectMode: "panel",
	reminders: [...DEFAULT_ENTRY_REMINDERS],
};

/** Read the calendar keys out of a stored `ui_settings`, field by field. Never throws. */
export function resolveCalendarPrefs(raw: unknown): CalendarPrefs {
	const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
	const mode = CalendarInspectMode.safeParse(value.calendar_inspect_mode);
	const reminders = EntryRemindersSchema.safeParse(value.calendar_reminders);
	return {
		inspectMode: mode.success ? mode.data : DEFAULT_CALENDAR_PREFS.inspectMode,
		reminders: reminders.success
			? normalizeReminders(reminders.data)
			: DEFAULT_CALENDAR_PREFS.reminders,
	};
}
// #endregion
