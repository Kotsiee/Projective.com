import { assertEquals } from "@std/assert";
import { type EntryFields, RoutineSchema } from "@projective/types/scheduling";
import { mintSlug } from "@projective/types/slugs";
import type { ReadActor } from "../read-actor.ts";
import { createEntries, type EntryDeps, updateEntry } from "./live-entries.ts";
import { createRoutine, organiseEntry, updateRoutine } from "./live-routines.ts";
import { type StubRpc, stubSchedulingClient, type StubStore } from "./scheduling-stub-client.ts";

/**
 * live-routines_test — a person's routines over a stub database: what reaches the row, a refusal in
 * the service's words, and the two changes to an entry's own write (Decision #389). What the database
 * itself refuses is proved under a real role by `supabase/probes/scheduling_routines.sql`.
 */

// #region Fixtures
const HOST: ReadActor & { accessToken: string } = {
	userId: "0a0a0a0a-0000-4000-8000-000000000001",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
};
const MINE = "5c4d7a10-0000-4000-8000-000000000001";
const ROUTINE = "7a7a7a7a-0000-4000-8000-000000000001";
const ENTRY = "e0e0e0e0-0000-4000-8000-000000000001";
const SIBLING = "e0e0e0e0-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-05T10:00:00Z");
const HOUR = 3_600_000;

function store(): StubStore {
	return {
		schedules: [{ id: MINE, owner_type: "user", owner_id: HOST.userId, timezone: "Europe/London" }],
		routines: [{
			id: ROUTINE,
			schedule_id: MINE,
			name: "Gym",
			slug: mintSlug("routine"),
			color_token: "--primary",
			is_active: true,
			behavior: "passive",
			recurrence_rule: null,
			metadata: {},
			created_at: "2026-11-05T08:00:00+00:00",
			updated_at: "2026-11-05T08:00:00+00:00",
		}],
		events: [{
			id: ENTRY,
			schedule_id: MINE,
			project_id: null,
			source_connection_id: null,
			title: "Dentist",
			archived_at: null,
		}],
	};
}

function stack(s: StubStore, rpc: Record<string, StubRpc> = {}) {
	const stub = stubSchedulingClient(s, rpc);
	const asked: (readonly string[])[] = [];
	const reread: EntryDeps["reread"] = (ids) => {
		asked.push(ids);
		return Promise.resolve(ids.map((id) => ({ id, title: "", kind: "general", start: 0, end: 0 })));
	};
	return { ...stub, asked, deps: { db: stub.client, reread, now: NOW } satisfies EntryDeps };
}

const fields = (start: number, over: Partial<EntryFields> = {}): EntryFields => ({
	title: "Gym",
	kind: "sync",
	start,
	end: start + HOUR,
	...over,
});
// #endregion

// #region Routines
Deno.test("create: on the caller's own schedule, never one the request names", async () => {
	const s = store();
	const { deps } = stack(s);
	const res = await createRoutine({ name: "Spanish", behavior: "disruptive" }, HOST, deps);
	assertEquals(res.status, 201);
	const made = s.routines[1];
	assertEquals(made.schedule_id, MINE);
	assertEquals(made.behavior, "disruptive");
	assertEquals(res.data?.routine.name, "Spanish");
});

Deno.test("a read row is the routine the page schema parses", async () => {
	const { deps } = stack(store());
	const res = await updateRoutine({ id: ROUTINE, name: "Yoga" }, HOST, deps);
	assertEquals(RoutineSchema.safeParse(res.data?.routine).success, true);
	assertEquals(res.data?.routine.name, "Yoga");
});

Deno.test("update: only what was said is written, and archiving is one of those", async () => {
	const s = store();
	const { deps, updates } = stack(s);
	await updateRoutine({ id: ROUTINE, isActive: false }, HOST, deps);
	assertEquals(updates.at(-1)?.patch, { is_active: false });
	assertEquals(s.routines[0].name, "Gym");
});

Deno.test("update: a routine RLS hides reads as gone, and nothing to say is a 422", async () => {
	const { deps } = stack(store());
	const hidden = await updateRoutine(
		{ id: "7a7a7a7a-0000-4000-8000-000000000009", name: "Nope" },
		HOST,
		deps,
	);
	assertEquals(hidden.status, 404);
	assertEquals((await updateRoutine({ id: ROUTINE }, HOST, deps)).status, 422);
});
// #endregion

// #region Organising
Deno.test("organise: names only what moves, and answers every row that did", async () => {
	const { deps, calls, asked } = stack(store(), {
		organise_event: () => ({ data: [ENTRY, SIBLING] }),
	});
	const res = await organiseEntry({ eventId: ENTRY, routineId: ROUTINE }, HOST, deps);
	assertEquals(res.status, 200);
	assertEquals(calls[0].args, { p_event: ENTRY, p_changes: { routine_id: ROUTINE } });
	assertEquals(asked, [[ENTRY, SIBLING]]);
	assertEquals(res.data?.events.length, 2);
});

Deno.test("organise: null takes an entry out, which is a different thing from saying nothing", async () => {
	const { deps, calls } = stack(store(), { organise_event: () => ({ data: [ENTRY] }) });
	await organiseEntry({ eventId: ENTRY, routineId: null }, HOST, deps);
	assertEquals(calls[0].args.p_changes, { routine_id: null });
	assertEquals((await organiseEntry({ eventId: ENTRY }, HOST, deps)).status, 422);
});

Deno.test("organise: a derived id has no row, and the door's refusals keep their meaning", async () => {
	const held = stack(store(), {
		organise_event: () => ({
			error: { code: "55000", message: "event: this is a commitment, so it has to hold its time" },
		}),
	});
	assertEquals(
		(await organiseEntry({ eventId: "due-1", routineId: null }, HOST, held.deps)).status,
		403,
	);
	assertEquals(held.calls.length, 0);

	const refused = await organiseEntry(
		{ eventId: ENTRY, availabilityBehavior: "passive" },
		HOST,
		held.deps,
	);
	assertEquals(refused.status, 409);
	assertEquals(refused.message, "This is a commitment, so it has to hold its time.");

	const stranger = stack(store(), {
		organise_event: () => ({ error: { code: "42501", message: "event: not yours to organise" } }),
	});
	const answer = await organiseEntry({ eventId: ENTRY, routineId: null }, HOST, stranger.deps);
	assertEquals(answer.status, 403);
});
// #endregion

// #region An entry's own write
Deno.test("create: a rule makes a master and its occurrences, in one insert", async () => {
	const s = store();
	const { deps, updates } = stack(s);
	const rule = "FREQ=DAILY";
	const res = await createEntries(
		{
			entries: [
				fields(NOW + HOUR, {
					recurrenceRule: rule,
					routineId: ROUTINE,
					availabilityBehavior: "passive",
				}),
				fields(NOW + 25 * HOUR, { routineId: ROUTINE, availabilityBehavior: "passive" }),
				fields(NOW + 49 * HOUR, { routineId: ROUTINE, availabilityBehavior: "passive" }),
			],
		},
		HOST,
		deps,
	);
	assertEquals(res.status, 201);
	assertEquals(updates.length, 0);
	const [master, ...rest] = s.events.slice(1);
	assertEquals(master.recurrence_rule, rule);
	assertEquals(master.recurrence_parent_id, null);
	for (const row of rest) {
		assertEquals(row.recurrence_rule, null);
		assertEquals(row.recurrence_parent_id, master.id);
	}
	for (const row of [master, ...rest]) {
		assertEquals(row.routine_id, ROUTINE);
		assertEquals(row.availability_behavior, "passive");
	}
});

Deno.test("create: with no rule the rows are unrelated, and with nothing said an entry holds time", async () => {
	const s = store();
	const { deps } = stack(s);
	await createEntries({ entries: [fields(NOW + HOUR), fields(NOW + 2 * HOUR)] }, HOST, deps);
	const made = s.events.slice(1);
	// PostgREST writes NULL for a key only some rows name, so every row must carry every key.
	assertEquals(Object.keys(made[0]).sort(), Object.keys(made[1]).sort());
	for (const row of made) {
		assertEquals(row.recurrence_parent_id, null);
		assertEquals(row.routine_id, null);
		assertEquals(row.availability_behavior, "disruptive");
	}
});

Deno.test("edit: a refused behaviour leaves the entry untouched, not half saved", async () => {
	const s = store();
	const { deps, updates } = stack(s, {
		organise_event: () => ({
			error: { code: "55000", message: "event: this is a commitment, so it has to hold its time" },
		}),
	});
	const res = await updateEntry(
		{ ...fields(NOW, { title: "Renamed", availabilityBehavior: "passive" }), eventId: ENTRY },
		HOST,
		deps,
	);
	assertEquals(res.status, 409);
	assertEquals(updates.length, 0);
	assertEquals(s.events[0].title, "Dentist");
});

Deno.test("edit: the rest of a series it moved comes back beside it, and a rule is not re-read", async () => {
	const { deps, calls, updates } = stack(store(), {
		organise_event: () => ({ data: [ENTRY, SIBLING] }),
	});
	const res = await updateEntry(
		{
			...fields(NOW, { routineId: ROUTINE, recurrenceRule: "FREQ=DAILY" }),
			eventId: ENTRY,
		},
		HOST,
		deps,
	);
	assertEquals(res.data?.event.id, ENTRY);
	assertEquals(res.data?.series.map((e) => e.id), [SIBLING]);
	assertEquals(calls[0].args.p_changes, { routine_id: ROUTINE });
	assertEquals("recurrence_rule" in (updates.at(-1)?.patch ?? {}), false);
});
// #endregion
