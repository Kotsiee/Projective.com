/**
 * The cross-check for event recurrence (`scheduling.events.recurrence_rule` / `recurrence_parent_id`)
 * and the availability preset's `avp-` slug: the database's shape-only RRULE CHECK against the Zod
 * {@link RRuleText} it mirrors, a round trip through the row and projection schemas, and the RFC 5545
 * forms the parser accepts, normalises or refuses.
 *
 * The SQL half reads FILE CONTENT (the `presets.contract.test.ts` technique), so it fails with no
 * database the moment one side is edited without the other.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { mintSlug } from "../slugs/slug.ts";
import { parseRRule, serialiseRRule } from "./rrule.ts";
import { AvailabilityPresetRowSchema, RRuleText, SchedulingEventRowSchema } from "./rows.ts";
import { type CalendarEvent, CalendarEventSchema } from "./scheduling.ts";

const REPO = new URL("../../../", import.meta.url);
/** File text with whitespace collapsed, so an assertion never depends on line endings or wrapping. */
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\s+/g, " ");

const TABLES_SQL = "supabase/migrations/00000022_tables_scheduling.sql";
const TRIGGERS_SQL = "supabase/migrations/00001860_triggers_scheduling.sql";
const GRANTS_SQL = "supabase/migrations/00002520_permissions_table_grants.sql";

const RULE = "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH";
const MASTER_ID = "11111111-1111-4111-8111-111111111111";
const START = Date.UTC(2026, 10, 3, 9);

/** A `scheduling.events` row as the reader camel-cases it. */
function eventRow(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		scheduleId: "33333333-3333-4333-8333-333333333333",
		projectId: null,
		channelId: null,
		kind: "general",
		status: null,
		title: "Studio hours",
		startsAt: "2026-11-03T09:00:00+00:00",
		endsAt: "2026-11-03T10:00:00+00:00",
		allDay: false,
		isMasked: false,
		accent: null,
		location: null,
		description: null,
		meta: null,
		attendeeCount: null,
		capacity: null,
		href: null,
		sourceConnectionId: null,
		externalEventId: null,
		externalSync: true,
		sourceSessionEventId: null,
		recurrenceRule: null,
		recurrenceParentId: null,
		routineId: null,
		availabilityBehavior: "disruptive",
		createdBy: null,
		createdAt: "2026-11-03T08:00:00+00:00",
		updatedAt: "2026-11-03T08:00:00+00:00",
		archivedAt: null,
		...over,
	};
}

// #region The column and the schema
Deno.test("the events RRULE CHECK is the shape RRuleText parses, within the same 400", () => {
	const sql = read(TABLES_SQL);
	assertStringIncludes(
		sql,
		"recurrence_rule text CHECK (char_length(recurrence_rule) <= 400 AND recurrence_rule ~ '^FREQ=')",
	);
	// The preset rule column shares the one Zod shape; both CHECKs must stay the same figure.
	assertStringIncludes(
		sql,
		"rrule text NOT NULL CHECK (char_length(rrule) <= 400 AND rrule ~ '^FREQ=')",
	);
	const ofLength = (n: number) => "FREQ=DAILY;X-PAD=" + "A".repeat(n - 17);
	assert(RRuleText.safeParse(ofLength(400)).success);
	assertFalse(RRuleText.safeParse(ofLength(401)).success);
});

Deno.test("a series is one level deep and on one anchor, in the table and in the row schema", () => {
	const sql = read(TABLES_SQL);
	assertStringIncludes(
		sql,
		"recurrence_parent_id uuid REFERENCES scheduling.events (id) ON DELETE CASCADE",
	);
	assertStringIncludes(
		sql,
		"CONSTRAINT ck_event_recurrence_shape CHECK (recurrence_parent_id IS NULL OR recurrence_rule IS NULL)",
	);
	assertStringIncludes(
		sql,
		"CONSTRAINT ck_event_recurrence_not_self CHECK (recurrence_parent_id <> id)",
	);
	assertStringIncludes(
		read(TRIGGERS_SQL),
		"BEFORE INSERT OR UPDATE OF recurrence_rule, recurrence_parent_id, schedule_id, project_id ON scheduling.events",
	);
	assertFalse(
		SchedulingEventRowSchema.safeParse(
			eventRow({ recurrenceRule: RULE, recurrenceParentId: MASTER_ID }),
		).success,
	);
});

Deno.test("a client role may read both columns, or every /calendar read is refused", () => {
	// SELECT on scheduling.events is column-level (the room is withheld), and live-calendar.ts selects
	// both recurrence columns under the user's JWT.
	const grant = read(GRANTS_SQL).match(
		/GRANT SELECT \(([^)]*)\) ON TABLE scheduling\.events TO authenticated/,
	);
	assert(grant, "the column-level SELECT grant on scheduling.events moved");
	const columns = grant[1].split(",").map((c) => c.trim());
	for (const column of ["recurrence_rule", "recurrence_parent_id"]) {
		assert(columns.includes(column), `${column} is not granted to authenticated`);
	}
});
// #endregion

// #region Round trips
Deno.test("row round trip: a master, an occurrence and a one-off parse back to themselves", () => {
	for (
		const row of [
			eventRow({ recurrenceRule: RULE }),
			eventRow({ recurrenceParentId: MASTER_ID }),
			eventRow(),
		]
	) {
		assertEquals(SchedulingEventRowSchema.parse(row), row);
	}
	assertFalse(
		SchedulingEventRowSchema.safeParse(eventRow({ recurrenceParentId: "evt-1" })).success,
	);
});

Deno.test("projection round trip: CalendarEvent carries both fields through JSON", () => {
	const base = {
		title: "Studio hours",
		kind: "general",
		start: START,
		end: START + 3_600_000,
	} as const;
	const master: CalendarEvent = { ...base, id: MASTER_ID, recurrenceRule: RULE };
	const occurrence: CalendarEvent = { ...base, id: "occ-2", recurrenceParentId: MASTER_ID };
	for (const event of [master, occurrence]) {
		assertEquals(CalendarEventSchema.parse(JSON.parse(JSON.stringify(event))), event);
	}
	assertFalse(
		CalendarEventSchema.safeParse({ ...master, recurrenceRule: `RRULE:${RULE}` }).success,
	);
});

Deno.test("a preset row carries the minted avp- address, and no other entity's", () => {
	const row = {
		id: MASTER_ID,
		scheduleId: "33333333-3333-4333-8333-333333333333",
		scope: "library" as const,
		blueprintId: null,
		slug: mintSlug("preset"),
		name: "General",
		description: "",
		isDefault: true,
		compiledFrom: null,
		compiledThrough: null,
		archivedAt: null,
		createdAt: "2026-11-03T08:00:00+00:00",
		updatedAt: "2026-11-03T08:00:00+00:00",
	};
	assertEquals(AvailabilityPresetRowSchema.parse(row), row);
	assertFalse(AvailabilityPresetRowSchema.safeParse({ ...row, slug: mintSlug("project") }).success);
	assertFalse(AvailabilityPresetRowSchema.safeParse({ ...row, slug: "general" }).success);
});
// #endregion

// #region RFC 5545
Deno.test("RFC 5545: any part order or case parses, and the stored form is the serialiser's", () => {
	const parsed = parseRRule(RULE);
	assert(parsed.ok);
	assertEquals(parsed.value.freq, "WEEKLY");
	assertEquals(parsed.value.interval, 2);
	assertEquals(parsed.value.byDay.map((d) => d.wd), [2, 4]);
	assertEquals(serialiseRRule(parsed.value), RULE);

	// RFC 5545 leaves part order free and the parser takes any of it; the column takes only the
	// normalised form, so a writer stores serialiseRRule(parseRRule(x)), never the raw input.
	for (const raw of ["BYDAY=TU,TH;INTERVAL=2;FREQ=WEEKLY", `RRULE:${RULE}`, RULE.toLowerCase()]) {
		const read = parseRRule(raw);
		assert(read.ok, raw);
		assertFalse(RRuleText.safeParse(raw).success, raw);
		assertEquals(serialiseRRule(read.value), RULE);
	}
});

Deno.test("RFC 5545: the parser refuses what it cannot mean, and says which way", () => {
	const refusals: Record<string, string> = {
		"": "empty",
		"WEEKLY": "malformed",
		"FREQ=FORTNIGHTLY": "invalid_value",
		"FREQ=WEEKLY;INTERVAL=0": "invalid_value",
		"FREQ=WEEKLY;BYDAY=XX": "invalid_value",
		"FREQ=WEEKLY;FREQ=DAILY": "duplicate_part",
		"FREQ=HOURLY": "freq_unsupported",
	};
	for (const [raw, reason] of Object.entries(refusals)) {
		const read = parseRRule(raw);
		assert(!read.ok && read.reason === reason, `${JSON.stringify(raw)} should refuse as ${reason}`);
	}
	// The column is shape-only: an imported series' COUNT, which only ics-recurrence.ts expands, still
	// stores.
	assert(RRuleText.safeParse("FREQ=WEEKLY;COUNT=10").success);
});
// #endregion
