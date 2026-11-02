import { assert, assertEquals } from "@std/assert";
import { createRefusal, type EntryFields } from "@projective/types/scheduling";
import type { ReadActor } from "../read-actor.ts";
import { ScheduleBackendService } from "./ScheduleBackendService.ts";
import { createEntries, type EntryDeps, removeEntry, updateEntry } from "./live-entries.ts";
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

function stack(s: StubStore, rlsOwner = HOST.userId) {
	const stub = stubSchedulingClient(s, {}, rlsAs(s, rlsOwner));
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
	s.users_public = [{ user_id: HOST.userId, timezone: "Asia/Tokyo" }];
	const { deps } = stack(s);
	const res = await createEntries({ entries: [fields(NOW + HOUR)] }, HOST, deps);
	assert(res.ok);
	const opened = s.schedules.find((x) => x.owner_id === HOST.userId);
	assertEquals(opened?.timezone, "Asia/Tokyo");
	assertEquals(opened?.is_published, undefined);
	assertEquals(s.events.at(-1)?.schedule_id, opened?.id);
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

Deno.test("service: no session is a 401 before any database is asked", async () => {
	const anonymous: ReadActor = { userId: "", contextId: "", contextType: "personal" };
	const res = await ScheduleBackendService.createEntries(
		{ entries: [fields(NOW + HOUR)] },
		anonymous,
	);
	assertEquals(res.status, 401);
});
// #endregion
