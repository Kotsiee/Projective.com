import { assert, assertEquals, assertRejects } from "@std/assert";
import { createRefusal, type EntryFields } from "@projective/types/scheduling";
import type { ReadActor } from "../read-actor.ts";
import { ScheduleBackendService } from "./ScheduleBackendService.ts";
import {
	createEntries,
	type EntryDeps,
	removeEntry,
	setEntryReminders,
	updateEntry,
} from "./live-entries.ts";
import { stubSchedulingClient, type StubStore } from "./scheduling-stub-client.ts";

/**
 * live-entries_test — a host's own `/calendar` entries over a stub database: a past create is refused
 * with the composer's own words, edit and delete are the host's alone (past or not), a delete is a
 * soft archive, and a write the RLS policy refuses is answered `403` with nothing written.
 */

// #region Fixtures
const HOST: ReadActor & { accessToken: string } = {
	userId: "0a0a0a0a-0000-4000-8000-000000000001",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
};
const OTHER = "0b0b0b0b-0000-4000-8000-000000000002";
const MINE = "5c4d7a10-0000-4000-8000-000000000001";
const THEIRS = "5c4d7a10-0000-4000-8000-000000000002";
const ENTRY = "e0e0e0e0-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-25T10:00:00Z");
const HOUR = 3_600_000;

function store(): StubStore {
	return {
		schedules: [
			{ id: MINE, owner_type: "user", owner_id: HOST.userId, timezone: "Europe/London" },
			{ id: THEIRS, owner_type: "user", owner_id: OTHER, timezone: "Europe/London" },
		],
		events: [{
			id: ENTRY,
			schedule_id: MINE,
			project_id: null,
			title: "Dentist",
			status: "confirmed",
			starts_at: new Date(NOW - 48 * HOUR).toISOString(),
			ends_at: new Date(NOW - 47 * HOUR).toISOString(),
			archived_at: null,
		}],
	};
}

/** The `Manage scheduling events` policy, over the stub: the row's schedule is `ownerId`'s. */
function rlsAs(s: StubStore, ownerId: string) {
	return {
		events: (row: Record<string, unknown>) =>
			!row.project_id &&
			s.schedules.some((x) => x.id === row.schedule_id && x.owner_id === ownerId),
	};
}

function stack(s: StubStore, rlsOwner = HOST.userId, rpc: Parameters<typeof stubSchedulingClient>[1] = {}) {
	const stub = stubSchedulingClient(s, rpc, rlsAs(s, rlsOwner));
	const reread: EntryDeps["reread"] = (ids) =>
		Promise.resolve(ids.map((id) => ({ id, title: "", kind: "general", start: 0, end: 0 })));
	return { ...stub, deps: { db: stub.client, reread, now: NOW } satisfies EntryDeps };
}

const fields = (start: number, over: Partial<EntryFields> = {}): EntryFields => ({
	title: "Focus",
	kind: "general",
	start,
	end: start + HOUR,
	...over,
});
// #endregion

// #region Create
Deno.test("create: a past start is refused 422 in createRefusal's own words, and nothing is written", async () => {
	const s = store();
	const { deps } = stack(s);
	const res = await createEntries(
		{ entries: [fields(NOW + HOUR), fields(NOW - HOUR)] },
		HOST,
		deps,
	);
	assertEquals(res.status, 422);
	assertEquals(res.message, createRefusal(NOW, fields(NOW - HOUR)));
	assertEquals(res.errors?.start, res.message);
	assertEquals(s.events.length, 1);
});

Deno.test("create: today's all-day entry is creatable after midnight; an end before its start is not", async () => {
	const { deps } = stack(store());
	const midnight = Date.parse("2026-10-25T00:00:00Z");
	const allDay = { ...fields(midnight), end: midnight + 24 * HOUR, allDay: true };
	assert((await createEntries({ entries: [allDay] }, HOST, deps)).ok);
	const backwards = await createEntries(
		{ entries: [{ ...fields(NOW + HOUR), end: NOW }] },
		HOST,
		deps,
	);
	assertEquals(backwards.status, 422);
});

Deno.test("create: a series is one insert on the caller's own schedule, answered as re-read", async () => {
	const s = store();
	const { deps } = stack(s);
	const res = await createEntries(
		{ entries: [fields(NOW + HOUR), fields(NOW + 25 * HOUR, { location: "  " })] },
		HOST,
		deps,
	);
	assertEquals(res.status, 201);
	const made = s.events.slice(1);
	assertEquals(made.length, 2);
	for (const row of made) {
		assertEquals(row.schedule_id, MINE);
		assertEquals(row.created_by, HOST.userId);
		assertEquals(row.status, "confirmed");
	}
	assertEquals(made[1].location, null);
	assertEquals(res.data?.events.map((e) => e.id), made.map((r) => r.id));
});

Deno.test("create: the agenda is stored sanitised — script and handlers gone, the editor's tags kept", async () => {
	const s = store();
	const { deps } = stack(s);
	const agenda = "<p>Bring <strong>notes</strong></p><script>alert(1)</script>" +
		'<img src=x onerror="alert(1)"><p onclick="alert(1)">Q&amp;A</p>';
	const res = await createEntries(
		{
			entries: [
				fields(NOW + HOUR, { description: agenda }),
				fields(NOW + 2 * HOUR, { description: "<p><br></p>" }),
			],
		},
		HOST,
		deps,
	);
	assert(res.ok, res.message);
	const [made, blank] = s.events.slice(1);
	assertEquals(made.description, "<p>Bring <strong>notes</strong></p><p>Q&amp;A</p>");
	// An emptied editor's markup is no agenda at all.
	assertEquals(blank.description, null);
});

Deno.test("create: the first entry opens an unpublished schedule in the profile's zone", async () => {
	const s = store();
	s.schedules = s.schedules.filter((x) => x.owner_id !== HOST.userId);
	const { deps } = stack(s, HOST.userId, {
		get_own_private_profile: () => ({ data: [{ timezone: "Asia/Tokyo" }] }),
	});
	const res = await createEntries({ entries: [fields(NOW + HOUR)] }, HOST, deps);
	assert(res.ok);
	const opened = s.schedules.find((x) => x.owner_id === HOST.userId);
	assertEquals(opened?.timezone, "Asia/Tokyo");
	assertEquals(opened?.is_published, undefined);
	assertEquals(s.events.at(-1)?.schedule_id, opened?.id);
});

Deno.test("create: a zone it cannot read opens no schedule, so the default is never fixed on one", async () => {
	const s = store();
	s.schedules = s.schedules.filter((x) => x.owner_id !== HOST.userId);
	const { deps } = stack(s, HOST.userId, {
		get_own_private_profile: () => ({ error: { code: "42501", message: "denied" } }),
	});
	await assertRejects(() => createEntries({ entries: [fields(NOW + HOUR)] }, HOST, deps));
	assertEquals(s.schedules.filter((x) => x.owner_id === HOST.userId), []);
});
// #endregion

// #region The room
const ROOM = { provider: "zoom", link: null, passcode: null } as const;

Deno.test("connected: an entry from a connected calendar is read-only, whoever's schedule it is on", async () => {
	const s = store();
	s.events[0].source_connection_id = "33333333-3333-4333-8333-333333333333";
	const { deps } = stack(s);
	const edit = await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR) }, HOST, deps);
	const del = await removeEntry({ eventId: ENTRY }, HOST, deps);
	assertEquals([edit.status, del.status], [403, 403]);
	assertEquals(s.events[0].title, "Dentist");
	assertEquals(s.events[0].archived_at, null);
});

Deno.test("room: a saved entry's room goes through the door, once for a whole series", async () => {
	const { deps, calls } = stack(store());
	const res = await createEntries(
		{ entries: [fields(NOW + HOUR), fields(NOW + 25 * HOUR)], room: ROOM },
		HOST,
		deps,
	);
	assert(res.ok, res.message);
	const doors = calls.filter((c) => c.name === "set_entry_room");
	assertEquals(doors.length, 1);
	assertEquals((doors[0].args.p_events as string[]).length, 2);
	assertEquals(doors[0].args.p_provider, "zoom");
});

Deno.test("room: an edit that says nothing leaves it alone, and null takes it away", async () => {
	const { deps, calls } = stack(store());
	await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR) }, HOST, deps);
	assertEquals(calls.filter((c) => c.name === "set_entry_room").length, 0);

	await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR), room: null }, HOST, deps);
	const [door] = calls.filter((c) => c.name === "set_entry_room");
	assertEquals(door.args.p_provider, null);
	assertEquals(door.args.p_events, [ENTRY]);
});

Deno.test("room: a refused room does not lose the saved entry", async () => {
	const { deps } = stack(store(), HOST.userId, {
		set_entry_room: () => ({ error: { code: "42501", message: "no" } }),
	});
	const res = await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR), room: ROOM }, HOST, deps);
	assert(res.ok, res.message);
});
// #endregion

// #region Host-only edit and delete
Deno.test("edit: the host edits their own entry even though it is in the past", async () => {
	const s = store();
	const { deps } = stack(s);
	const res = await updateEntry(
		{ eventId: ENTRY, ...fields(NOW - 72 * HOUR, { title: "Dentist (moved)" }) },
		HOST,
		deps,
	);
	assert(res.ok, res.message);
	assertEquals(s.events[0].title, "Dentist (moved)");
	assertEquals(s.events[0].starts_at, new Date(NOW - 72 * HOUR).toISOString());
});

Deno.test("edit: a new agenda is written sanitised, and an edit without one clears it", async () => {
	const s = store();
	const { deps } = stack(s);
	const edit = (description?: string) =>
		updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR, { description }) }, HOST, deps);
	assert((await edit('<h2 style="x">Plan</h2><iframe src="//evil"></iframe>')).ok);
	assertEquals(s.events[0].description, "<h2>Plan</h2>");
	assert((await edit()).ok);
	assertEquals(s.events[0].description, null);
});

Deno.test("edit / delete: an entry on somebody else's schedule is a 403, and nothing is written", async () => {
	const s = store();
	s.events[0].schedule_id = THEIRS;
	const { deps, updates } = stack(s);
	const edit = await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR) }, HOST, deps);
	const del = await removeEntry({ eventId: ENTRY }, HOST, deps);
	assertEquals([edit.status, del.status], [403, 403]);
	assertEquals(updates.length, 0);
	assertEquals(s.events[0].title, "Dentist");
});

Deno.test("edit: an engagement's event is never the host's to edit here", async () => {
	const s = store();
	s.events[0].project_id = "9f9f9f9f-0000-4000-8000-000000000009";
	const { deps } = stack(s);
	assertEquals(
		(await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR) }, HOST, deps)).status,
		403,
	);
});

Deno.test("delete: soft — the row stays, cancelled and archived; a second delete is a 404", async () => {
	const s = store();
	const { deps } = stack(s);
	const res = await removeEntry({ eventId: ENTRY }, HOST, deps);
	assert(res.ok, res.message);
	assertEquals(s.events.length, 1);
	assertEquals(s.events[0].status, "cancelled");
	assertEquals(s.events[0].archived_at, new Date(NOW).toISOString());
	assertEquals((await removeEntry({ eventId: ENTRY }, HOST, deps)).status, 404);
	assertEquals(
		(await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR) }, HOST, deps)).status,
		404,
	);
});

Deno.test("edit: a derived entry's id (a due date) is a 403, never a database error", async () => {
	const { deps, updates } = stack(store());
	const res = await updateEntry({ eventId: "due-stg-abc", ...fields(NOW + HOUR) }, HOST, deps);
	assertEquals(res.status, 403);
	assertEquals(updates.length, 0);
});
// #endregion

// #region The RLS path
Deno.test("RLS: a write the policy refuses is a 403 with nothing written, whatever the app check said", async () => {
	// The actor's id is an unverified decode; here it claims the host while the token is somebody
	// else's, so the app-level check passes and the policy is what refuses.
	const s = store();
	const { deps } = stack(s, OTHER);
	const edit = await updateEntry({ eventId: ENTRY, ...fields(NOW + HOUR) }, HOST, deps);
	const del = await removeEntry({ eventId: ENTRY }, HOST, deps);
	const make = await createEntries({ entries: [fields(NOW + HOUR)] }, HOST, deps);
	assertEquals([edit.status, del.status, make.status], [403, 403, 403]);
	assertEquals(s.events.length, 1);
	assertEquals(s.events[0].title, "Dentist");
	assertEquals(s.events[0].archived_at, null);
});

const TEN_IN_APP = { minutes: 10, channel: "in_app" } as const;
const HOUR_EMAIL = { minutes: 60, channel: "email" } as const;

/** A stack whose `event_reminders` policy is `Own event reminders`, for the entries in `seats`. */
function reminderStack(s: StubStore, seats: readonly string[]) {
	const stub = stubSchedulingClient(s, {}, {
		event_reminders: (row) => row.user_id === HOST.userId && seats.includes(String(row.event_id)),
	});
	const reread: EntryDeps["reread"] = (ids) =>
		Promise.resolve(ids.map((id) => ({ id, title: "", kind: "general", start: 0, end: 0 })));
	return { deps: { db: stub.client, reread, now: NOW } satisfies EntryDeps };
}

Deno.test("reminders: any seat sets their own, even on an entry they could never edit", async () => {
	const s = store();
	s.events[0].schedule_id = THEIRS;
	const { deps } = reminderStack(s, [ENTRY]);
	const res = await setEntryReminders(
		{ eventId: ENTRY, reminders: [HOUR_EMAIL, TEN_IN_APP, HOUR_EMAIL] },
		HOST,
		deps,
	);
	assert(res.ok);
	assertEquals(s.event_reminders, [{
		event_id: ENTRY,
		user_id: HOST.userId,
		// Normalised on the way in: nearest first, no two alike.
		reminders: [TEN_IN_APP, HOUR_EMAIL],
	}]);
});

Deno.test("reminders: a second write replaces the first, and [] is kept as none", async () => {
	const s = store();
	const { deps } = reminderStack(s, [ENTRY]);
	await setEntryReminders({ eventId: ENTRY, reminders: [TEN_IN_APP] }, HOST, deps);
	await setEntryReminders({ eventId: ENTRY, reminders: [] }, HOST, deps);
	assertEquals(s.event_reminders.map((r) => r.reminders), [[]]);
});

Deno.test("reminders: null returns to the default without touching anyone else's", async () => {
	const s = store();
	s.event_reminders = [
		{ event_id: ENTRY, user_id: HOST.userId, reminders: [TEN_IN_APP] },
		{ event_id: ENTRY, user_id: OTHER, reminders: [HOUR_EMAIL] },
	];
	const { deps } = reminderStack(s, [ENTRY]);
	assert((await setEntryReminders({ eventId: ENTRY, reminders: null }, HOST, deps)).ok);
	assertEquals(s.event_reminders.map((r) => r.user_id), [OTHER]);
});

Deno.test("reminders: an entry not on the caller's calendar is a 403 with nothing written", async () => {
	const s = store();
	const { deps } = reminderStack(s, []);
	const res = await setEntryReminders({ eventId: ENTRY, reminders: [TEN_IN_APP] }, HOST, deps);
	assertEquals(res.status, 403);
	assertEquals(s.event_reminders, undefined);
});

Deno.test("reminders: what has no row, or alerts elsewhere, takes none", async () => {
	const { deps } = reminderStack(store(), [ENTRY]);
	const input = { reminders: [TEN_IN_APP] };
	// A stage's due date is derived: nothing to hang an alert on.
	assertEquals((await setEntryReminders({ ...input, eventId: "due-x" }, HOST, deps)).status, 409);

	for (const over of [{ source_connection_id: OTHER }, { source_session_event_id: OTHER }]) {
		const s = store();
		Object.assign(s.events[0], over);
		const stack = reminderStack(s, [ENTRY]);
		const res = await setEntryReminders({ ...input, eventId: ENTRY }, HOST, stack.deps);
		assertEquals(res.status, 409);
	}

	const gone = store();
	gone.events[0].archived_at = new Date(NOW).toISOString();
	const stack = reminderStack(gone, [ENTRY]);
	const res = await setEntryReminders({ ...input, eventId: ENTRY }, HOST, stack.deps);
	assertEquals(res.status, 404);
});

Deno.test("reminders: a create keeps its list on every entry of a series", async () => {
	const s = store();
	const stub = stubSchedulingClient(s, {}, rlsAs(s, HOST.userId));
	const deps: EntryDeps = {
		db: stub.client,
		reread: (ids) =>
			Promise.resolve(ids.map((id) => ({ id, title: "", kind: "general", start: 0, end: 0 }))),
		now: NOW,
	};
	const res = await createEntries(
		{ entries: [fields(NOW + HOUR), fields(NOW + 2 * HOUR)], reminders: [HOUR_EMAIL] },
		HOST,
		deps,
	);
	assert(res.ok);
	assertEquals(s.event_reminders.length, 2);
	assertEquals(s.event_reminders[0].reminders, [HOUR_EMAIL]);
});

Deno.test("reminders: a create that says nothing writes no row, so the default stands", async () => {
	const s = store();
	const { deps } = stack(s);
	assert((await createEntries({ entries: [fields(NOW + HOUR)] }, HOST, deps)).ok);
	assertEquals(s.event_reminders, undefined);
});

Deno.test("service: no session is a 401 before any database is asked", async () => {
	const anonymous: ReadActor = { userId: "", contextId: "", contextType: "personal" };
	const res = await ScheduleBackendService.createEntries(
		{ entries: [fields(NOW + HOUR)] },
		anonymous,
	);
	assertEquals(res.status, 401);
});
// #endregion
