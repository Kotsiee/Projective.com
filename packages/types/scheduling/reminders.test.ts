import { assert, assertEquals, assertFalse } from "@std/assert";
import { UserPreferencesUpdateSchema } from "../org/preferences.ts";
import {
	DEFAULT_CALENDAR_PREFS,
	DEFAULT_ENTRY_REMINDERS,
	entryClassOf,
	EntryRemindersSchema,
	nextReminder,
	normalizeReminders,
	REMINDER_LEAD_MAX_MINUTES,
	REMINDER_LEADS,
	reminderLabel,
	reminderLeadLabel,
	REMINDERS_MAX,
	resolveCalendarPrefs,
	takesReminders,
} from "./reminders.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");
const FN_SQL = "supabase/migrations/00001510_functions_scheduling.sql";

Deno.test("entryClassOf — the row's shape decides, never its kind alone", () => {
	assertEquals(entryClassOf({ kind: "sync", start: 0, end: 60 }), "event");
	assertEquals(entryClassOf({ kind: "general", start: 0, end: 60 }), "event");
	assertEquals(entryClassOf({ kind: "general", start: 60, end: 60 }), "reminder");
	assertEquals(entryClassOf({ kind: "session", start: 60, end: 60 }), "reminder");
});

Deno.test("entryClassOf — a deadline is a Reminder even with a span a seed gave it", () => {
	assertEquals(entryClassOf({ kind: "deadline", start: 0, end: 60 }), "reminder");
});

Deno.test("reminderLeadLabel — says the largest whole unit, and the singular", () => {
	assertEquals(reminderLeadLabel(0), "At the time");
	assertEquals(reminderLeadLabel(1), "1 minute before");
	assertEquals(reminderLeadLabel(10), "10 minutes before");
	assertEquals(reminderLeadLabel(60), "1 hour before");
	assertEquals(reminderLeadLabel(90), "90 minutes before");
	assertEquals(reminderLeadLabel(2880), "2 days before");
	assertEquals(reminderLeadLabel(10_080), "1 week before");
	assertEquals(reminderLabel({ minutes: 60, channel: "email" }), "1 hour before · Email");
});

Deno.test("normalizeReminders — nearest first, no two alike, capped", () => {
	assertEquals(
		normalizeReminders([
			{ minutes: 60, channel: "email" },
			{ minutes: 10, channel: "in_app" },
			{ minutes: 60, channel: "email" },
			{ minutes: 10, channel: "email" },
		]),
		[
			{ minutes: 10, channel: "email" },
			{ minutes: 10, channel: "in_app" },
			{ minutes: 60, channel: "email" },
		],
	);
	const many = REMINDER_LEADS.map((minutes) => ({ minutes, channel: "email" as const }));
	assertEquals(normalizeReminders(many).length, REMINDERS_MAX);
});

Deno.test("nextReminder — the nearest in-app lead not in use, skipping at-the-time", () => {
	assertEquals(nextReminder([]), { minutes: 5, channel: "in_app" });
	assertEquals(nextReminder([{ minutes: 5, channel: "in_app" }]), {
		minutes: 10,
		channel: "in_app",
	});
	// An email at that lead does not use the in-app one.
	assertEquals(nextReminder([{ minutes: 5, channel: "email" }]), {
		minutes: 5,
		channel: "in_app",
	});
	const all = REMINDER_LEADS.map((minutes) => ({ minutes, channel: "in_app" as const }));
	assertEquals(nextReminder(all), null);
});

Deno.test("EntryRemindersSchema — refuses what the producer would drop", () => {
	assert(EntryRemindersSchema.safeParse([]).success);
	assert(EntryRemindersSchema.safeParse([{ minutes: 0, channel: "email" }]).success);
	assertFalse(
		EntryRemindersSchema.safeParse([{ minutes: REMINDER_LEAD_MAX_MINUTES + 1, channel: "email" }])
			.success,
	);
	assertFalse(EntryRemindersSchema.safeParse([{ minutes: -1, channel: "email" }]).success);
	assertFalse(EntryRemindersSchema.safeParse([{ minutes: 10, channel: "sms" }]).success);
	assertFalse(
		EntryRemindersSchema.safeParse(
			Array.from({ length: REMINDERS_MAX + 1 }, () => ({ minutes: 10, channel: "email" })),
		).success,
	);
});

Deno.test("takesReminders — provider rows, sittings, and nobody's time take none", () => {
	const row = {
		kind: "sync",
		status: "confirmed",
		source_connection_id: null,
		source_session_event_id: null,
		archived_at: null,
	};
	assert(takesReminders(row));
	assert(takesReminders({ ...row, kind: "general", status: null }));
	assertFalse(takesReminders({ ...row, source_connection_id: "c" }));
	assertFalse(takesReminders({ ...row, source_session_event_id: "s" }));
	assertFalse(takesReminders({ ...row, status: "cancelled" }));
	assertFalse(takesReminders({ ...row, archived_at: "2026-11-05T00:00:00Z" }));
	for (const kind of ["availability", "busy", "holiday"]) {
		assertFalse(takesReminders({ ...row, kind }));
	}
});

Deno.test("resolveCalendarPrefs — field by field, never throws", () => {
	assertEquals(resolveCalendarPrefs(null), DEFAULT_CALENDAR_PREFS);
	assertEquals(resolveCalendarPrefs({}), DEFAULT_CALENDAR_PREFS);
	assertEquals(resolveCalendarPrefs({ calendar_inspect_mode: "drawer" }).inspectMode, "panel");
	assertEquals(resolveCalendarPrefs({ calendar_inspect_mode: "popover" }).inspectMode, "popover");
	// `[]` is the person's own answer, not a missing one.
	assertEquals(resolveCalendarPrefs({ calendar_reminders: [] }).reminders, []);
	assertEquals(
		resolveCalendarPrefs({ calendar_reminders: [{ minutes: "ten" }] }).reminders,
		[...DEFAULT_ENTRY_REMINDERS],
	);
});

Deno.test("ui_settings — the calendar keys are accepted, an unknown value is not", () => {
	const accepts = (uiSettings: unknown) =>
		UserPreferencesUpdateSchema.safeParse({ uiSettings }).success;
	assert(accepts({ calendar_inspect_mode: "popover" }));
	assert(accepts({ calendar_reminders: [{ minutes: 60, channel: "email" }] }));
	assertFalse(accepts({ calendar_inspect_mode: "drawer" }));
	assertFalse(accepts({ calendar_reminders: [{ minutes: 60, channel: "sms" }] }));
});

/** The body of one `CREATE OR REPLACE FUNCTION <name>(` … `$$;` block. */
function functionBody(name: string): string {
	const sql = read(FN_SQL);
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined in ${FN_SQL}`);
	return sql.slice(start, sql.indexOf("\n$$;", start));
}

Deno.test("contract — the producer's default is the one a surface shows", () => {
	assert(
		functionBody("scheduling.fn_event_alerts").includes(
			`'${JSON.stringify(DEFAULT_ENTRY_REMINDERS)}'::jsonb`,
		),
	);
});

Deno.test("contract — the producer keeps the schema's caps and channels", () => {
	const rows = functionBody("scheduling.fn_reminder_rows");
	assert(rows.includes(`m <= ${REMINDER_LEAD_MAX_MINUTES}`));
	assert(rows.includes(`LIMIT ${REMINDERS_MAX}`));
	assert(rows.includes(`IN ('in_app', 'email')`));
});

Deno.test("contract — the database's eligibility is takesReminders", () => {
	const fn = functionBody("scheduling.fn_event_takes_reminders");
	for (const column of ["source_connection_id", "source_session_event_id", "archived_at"]) {
		assert(fn.includes(`e.${column} IS NULL`), `${column} left the SQL rule`);
	}
	for (const kind of ["availability", "busy", "holiday"]) assert(fn.includes(`'${kind}'`));
});
